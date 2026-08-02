import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createComparer,
  type CompareRequest,
  type SearchAnalyticsSource,
} from "./analytics-compare.js";
import type { SearchAnalyticsQuery } from "./google-client.js";

const CURRENT = { startDate: "2026-07-03", endDate: "2026-07-04" };
const PRIOR = { startDate: "2026-07-01", endDate: "2026-07-02" };

function apiRow(
  key: string,
  clicks: number,
  impressions: number,
  position: number,
) {
  return {
    keys: [key],
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position,
  };
}

interface Recorder {
  source: SearchAnalyticsSource;
  requests: SearchAnalyticsQuery[];
}

/**
 * Responses are keyed by `startDate..endDate`, so one fixture serves both range
 * retrieval (whole window) and daily retrieval (one entry per day).
 */
function recordingSource(
  responses: Record<string, unknown>,
  failures: Record<string, string> = {},
): Recorder {
  const requests: SearchAnalyticsQuery[] = [];
  return {
    requests,
    source: {
      async querySearchAnalytics(input: SearchAnalyticsQuery) {
        requests.push(input);
        const key = `${input.startDate}..${input.endDate}`;
        const failure = failures[key];
        if (failure) throw new Error(failure);
        return responses[key] ?? { rows: [] };
      },
    },
  };
}

function request(overrides: Partial<CompareRequest> = {}): CompareRequest {
  return {
    siteUrl: "sc-domain:example.com",
    current: CURRENT,
    prior: PRIOR,
    dimensions: ["query"],
    ...overrides,
  };
}

test("joins both windows by union and leaves an absent side null", async () => {
  const { source } = recordingSource({
    "2026-07-03..2026-07-04": {
      rows: [apiRow("shared", 10, 100, 5), apiRow("new", 1, 40, 12)],
    },
    "2026-07-01..2026-07-02": {
      rows: [apiRow("shared", 4, 80, 9), apiRow("lost", 7, 60, 3)],
    },
  });

  const result = await createComparer(source).compare(
    request({ sort: [{ field: "current.impressions", direction: "desc" }] }),
  );

  assert.equal(result.counts.unionKeys, 3);
  const byKey = new Map(result.rows.map((row) => [row.keys[0], row]));

  assert.deepEqual(byKey.get("shared")?.delta, {
    clicks: 6,
    impressions: 20,
    ctr: 0.1 - 0.05,
    position: -4,
  });
  assert.equal(byKey.get("new")?.prior, null);
  assert.equal(byKey.get("new")?.delta, null);
  assert.equal(byKey.get("lost")?.current, null);
  assert.equal(byKey.get("lost")?.delta, null);
});

test("aggregates daily retrieval with an impression-weighted position", async () => {
  const { source, requests } = recordingSource({
    "2026-07-03..2026-07-03": { rows: [apiRow("agents md", 1, 10, 10)] },
    "2026-07-04..2026-07-04": { rows: [apiRow("agents md", 3, 30, 6)] },
    "2026-07-01..2026-07-01": { rows: [apiRow("agents md", 2, 20, 8)] },
    "2026-07-02..2026-07-02": { rows: [apiRow("agents md", 2, 20, 8)] },
  });

  const result = await createComparer(source).compare(
    request({ retrievalMode: "daily" }),
  );

  assert.equal(requests.length, 4);
  assert.deepEqual(result.rows[0]?.current, {
    clicks: 4,
    impressions: 40,
    ctr: 0.1,
    // (10 x 10 + 6 x 30) / 40, not the unweighted mean of 8.
    position: 7,
  });
  assert.equal(result.rows[0]?.prior?.position, 8);
  assert.equal(result.coverage.current.retrievalMode, "daily");
  assert.equal(result.coverage.current.requests, 2);
});

test("reuses one acquisition across differently filtered analyses", async () => {
  const { source, requests } = recordingSource({
    "2026-07-03..2026-07-04": {
      rows: [apiRow("big", 5, 500, 14), apiRow("small", 1, 20, 30)],
    },
    "2026-07-01..2026-07-02": { rows: [apiRow("big", 4, 400, 16)] },
  });
  const comparer = createComparer(source);

  await comparer.compare(request());
  const second = await comparer.compare(
    request({
      where: [
        { field: "current.impressions", operator: "gte", value: 100 },
        { field: "current.position", operator: "lte", value: 20 },
      ],
    }),
  );

  assert.equal(requests.length, 2);
  assert.deepEqual(
    second.rows.map((row) => row.keys[0]),
    ["big"],
  );
  assert.deepEqual(second.counts, {
    unionKeys: 2,
    matchedFilters: 1,
    returned: 1,
  });
});

test("re-acquires when an API-semantic input changes", async () => {
  const { source, requests } = recordingSource({
    "2026-07-03..2026-07-04": { rows: [apiRow("a", 1, 10, 5)] },
    "2026-07-01..2026-07-02": { rows: [apiRow("a", 1, 10, 5)] },
  });
  const comparer = createComparer(source);

  await comparer.compare(request());
  await comparer.compare(
    request({
      filters: [
        {
          dimension: "query",
          operator: "includingRegex",
          expression: "agents?",
        },
      ],
    }),
  );

  assert.equal(requests.length, 4);
});

test("excludes rows whose filtered metric is unknown", async () => {
  const { source } = recordingSource({
    "2026-07-03..2026-07-04": { rows: [apiRow("only-current", 9, 900, 4)] },
    "2026-07-01..2026-07-02": { rows: [apiRow("only-prior", 9, 900, 4)] },
  });

  const result = await createComparer(source).compare(
    request({
      where: [{ field: "delta.clicks", operator: "lte", value: 0 }],
    }),
  );

  assert.equal(result.counts.unionKeys, 2);
  assert.deepEqual(result.rows, []);
});

test("sorts by the requested metric and applies the limit", async () => {
  const { source } = recordingSource({
    "2026-07-03..2026-07-04": {
      rows: [
        apiRow("low", 1, 10, 3),
        apiRow("high", 2, 900, 30),
        apiRow("mid", 3, 100, 12),
      ],
    },
    "2026-07-01..2026-07-02": { rows: [] },
  });

  const result = await createComparer(source).compare(
    request({
      sort: [{ field: "current.impressions", direction: "desc" }],
      limit: 2,
    }),
  );

  assert.deepEqual(
    result.rows.map((row) => row.keys[0]),
    ["high", "mid"],
  );
  assert.equal(result.counts.returned, 2);
});

test("records a failed day and keeps the rest of the window", async () => {
  const { source } = recordingSource(
    {
      "2026-07-03..2026-07-03": { rows: [apiRow("a", 1, 10, 5)] },
      "2026-07-01..2026-07-01": { rows: [] },
      "2026-07-02..2026-07-02": { rows: [] },
    },
    { "2026-07-04..2026-07-04": "Search Console API request failed (503)" },
  );

  const result = await createComparer(source).compare(
    request({ retrievalMode: "daily" }),
  );

  assert.deepEqual(result.coverage.current.failedDates, [
    { date: "2026-07-04", error: "Search Console API request failed (503)" },
  ]);
  assert.equal(result.coverage.current.paginationExhausted, false);
  assert.equal(result.rows[0]?.current?.clicks, 1);
});

test("reports a truncated retrieval without claiming completeness", async () => {
  const { source } = recordingSource({
    "2026-07-03..2026-07-04": {
      rows: [apiRow("a", 1, 10, 5)],
      pagination: { truncated: true },
    },
    "2026-07-01..2026-07-02": { rows: [] },
  });

  const result = await createComparer(source).compare(request());

  assert.equal(result.coverage.current.rowCapReached, true);
  assert.equal(result.coverage.current.paginationExhausted, false);
  assert.equal(result.coverage.prior.rowCapReached, false);
  assert.match(result.coverage.caveat, /does not prove it is complete/);
});

const rejectedRequests: Array<{
  name: string;
  overrides: Partial<CompareRequest>;
  expected: RegExp;
}> = [
  {
    name: "a daily window wider than the request budget",
    overrides: {
      retrievalMode: "daily",
      current: { startDate: "2026-01-01", endDate: "2026-12-31" },
    },
    expected: /at most 92 days/,
  },
  {
    name: "a window that ends before it starts",
    overrides: {
      retrievalMode: "daily",
      current: { startDate: "2026-07-10", endDate: "2026-07-01" },
    },
    expected: /ends before it starts/,
  },
];

for (const testCase of rejectedRequests) {
  test(`rejects ${testCase.name}`, async () => {
    const { source } = recordingSource({});
    await assert.rejects(
      createComparer(source).compare(request(testCase.overrides)),
      testCase.expected,
    );
  });
}
