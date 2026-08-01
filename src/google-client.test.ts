import assert from "node:assert/strict";
import { test } from "node:test";
import type { OAuth2Client } from "google-auth-library";
import { SearchConsoleClient } from "./google-client.js";
import type { TokenStore } from "./token-store.js";

function fakeAuth(): OAuth2Client {
  return {
    credentials: { access_token: "test-access-token" },
    getAccessToken: async () => ({ token: "test-access-token" }),
  } as unknown as OAuth2Client;
}

const unusedStore = {} as TokenStore;

test("paginates Search Analytics and preserves filters", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const pages = [
    [{ keys: ["first"] }, { keys: ["second"] }],
    [{ keys: ["third"] }],
  ];
  const mockedFetch: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json({ rows: pages[requests.length - 1] });
  };
  const client = new SearchConsoleClient(fakeAuth(), unusedStore, {
    baseUrl: "https://example.test/webmasters/v3",
    fetch: mockedFetch,
  });

  const response = (await client.querySearchAnalytics({
    siteUrl: "sc-domain:example.com",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    dimensions: ["page", "query"],
    filters: [
      { dimension: "page", operator: "contains", expression: "/blog/" },
    ],
    pageSize: 2,
    allPages: true,
    maxRows: 10,
  })) as {
    rows: unknown[];
    pagination: { returnedRows: number; nextStartRow: number };
  };

  assert.equal(requests.length, 2);
  assert.equal(
    requests[0]?.url,
    "https://example.test/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query",
  );
  assert.equal(requests[1]?.body.startRow, 2);
  assert.deepEqual(requests[0]?.body.dimensionFilterGroups, [
    {
      groupType: "and",
      filters: [
        { dimension: "page", operator: "contains", expression: "/blog/" },
      ],
    },
  ]);
  assert.equal(response.rows.length, 3);
  assert.deepEqual(response.pagination, {
    returnedRows: 3,
    nextStartRow: 3,
    truncated: false,
  });
});

test("uses the official site, sitemap, and inspection routes", async () => {
  const requests: Array<{
    url: string;
    method?: string | undefined;
    body?: string | undefined;
  }> = [];
  const mockedFetch: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: String(init?.body ?? ""),
    });
    return Response.json({ ok: true });
  };
  const client = new SearchConsoleClient(fakeAuth(), unusedStore, {
    baseUrl: "https://example.test/webmasters/v3",
    inspectionBaseUrl: "https://inspection.test/v1",
    fetch: mockedFetch,
  });

  await client.listSites();
  await client.listSitemaps(
    "https://example.com/",
    "https://example.com/sitemap.xml",
  );
  await client.inspectUrl(
    "sc-domain:example.com",
    "https://example.com/page",
    "en-GB",
  );

  assert.equal(requests[0]?.url, "https://example.test/webmasters/v3/sites");
  assert.match(
    requests[1]?.url ?? "",
    /sitemaps\?sitemapIndex=https%3A%2F%2Fexample.com/,
  );
  assert.equal(
    requests[2]?.url,
    "https://inspection.test/v1/urlInspection/index:inspect",
  );
  assert.deepEqual(JSON.parse(requests[2]?.body ?? "{}"), {
    siteUrl: "sc-domain:example.com",
    inspectionUrl: "https://example.com/page",
    languageCode: "en-GB",
  });
});

test("returns a sanitized API error", async () => {
  const client = new SearchConsoleClient(fakeAuth(), unusedStore, {
    fetch: async () =>
      Response.json(
        { error: { message: "Permission denied" } },
        { status: 403 },
      ),
  });
  await assert.rejects(client.listSites(), /\(403\): Permission denied/);
});
