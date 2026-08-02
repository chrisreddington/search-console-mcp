import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  SearchAnalyticsQuery,
  SearchConsoleClient,
} from "./google-client.js";
import { createServer } from "./server.js";

const COMPARE_WINDOWS = {
  siteUrl: "sc-domain:example.com",
  currentStartDate: "2026-07-03",
  currentEndDate: "2026-07-04",
  priorStartDate: "2026-07-01",
  priorEndDate: "2026-07-02",
};

function fakeApi(
  querySearchAnalytics: (
    input: SearchAnalyticsQuery,
  ) => Promise<unknown> = async () => ({
    rows: [],
  }),
): SearchConsoleClient {
  return {
    listSites: async () => ({
      siteEntry: [{ siteUrl: "sc-domain:example.com" }],
    }),
    listSitemaps: async () => ({ sitemap: [] }),
    inspectUrl: async () => ({
      inspectionResult: { indexStatusResult: { verdict: "PASS" } },
    }),
    querySearchAnalytics,
  } as unknown as SearchConsoleClient;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("");
}

/** Connects a client to a server over an in-memory pair and closes both after. */
async function withServer(
  api: SearchConsoleClient,
  body: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createServer(api);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await body(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("publishes and invokes the read-only MCP tools", async () => {
  await withServer(fakeApi(), async (client) => {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "gsc_compare_search_analytics",
      "gsc_inspect_url",
      "gsc_list_sitemaps",
      "gsc_list_sites",
      "gsc_query_search_analytics",
    ]);
    assert.ok(
      tools.tools.every((tool) => tool.annotations?.readOnlyHint === true),
    );

    const response = await client.callTool({
      name: "gsc_list_sites",
      arguments: {},
    });
    assert.equal(response.isError, undefined);
    assert.match(JSON.stringify(response.content), /sc-domain:example.com/);
  });
});

test("compares two windows and reports coverage", async () => {
  const rowsByWindow: Record<string, unknown> = {
    "2026-07-03": {
      rows: [{ keys: ["agents md"], clicks: 6, impressions: 300, position: 9 }],
    },
    "2026-07-01": {
      rows: [
        { keys: ["agents md"], clicks: 2, impressions: 200, position: 14 },
      ],
    },
  };
  const api = fakeApi(
    async (input) => rowsByWindow[input.startDate] ?? { rows: [] },
  );

  await withServer(api, async (client) => {
    const response = await client.callTool({
      name: "gsc_compare_search_analytics",
      arguments: { ...COMPARE_WINDOWS, dimensions: ["query"] },
    });

    assert.equal(response.isError, undefined);
    const payload = JSON.parse(textOf(response.content)) as {
      rows: Array<{
        keys: string[];
        delta: { clicks: number; position: number };
      }>;
      coverage: { current: { rowCapReached: boolean }; caveat: string };
    };

    assert.deepEqual(payload.rows[0]?.keys, ["agents md"]);
    assert.equal(payload.rows[0]?.delta.clicks, 4);
    assert.equal(payload.rows[0]?.delta.position, -5);
    assert.equal(payload.coverage.current.rowCapReached, false);
    assert.match(payload.coverage.caveat, /does not prove it is complete/);
  });
});

test("refuses a time dimension that cannot join across windows", async () => {
  await withServer(fakeApi(), async (client) => {
    const response = await client.callTool({
      name: "gsc_compare_search_analytics",
      arguments: { ...COMPARE_WINDOWS, dimensions: ["date"] },
    });

    assert.equal(response.isError, true);
    assert.match(
      textOf(response.content),
      /expected one of "country"\|"device"\|"page"\|"query"\|"searchAppearance" at dimensions\[0\]/,
    );
  });
});

test("returns an error result rather than throwing when the API fails", async () => {
  const api = fakeApi(async () => {
    throw new Error(
      "Search Console API request failed (403): Permission denied",
    );
  });

  await withServer(api, async (client) => {
    const response = await client.callTool({
      name: "gsc_compare_search_analytics",
      arguments: { ...COMPARE_WINDOWS, dimensions: ["page"] },
    });

    assert.equal(response.isError, true);
    assert.match(JSON.stringify(response.content), /Permission denied/);
  });
});
