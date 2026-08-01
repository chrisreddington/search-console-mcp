import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SearchConsoleClient } from "./google-client.js";
import { createServer } from "./server.js";

test("publishes and invokes the read-only MCP tools", async () => {
  const api = {
    listSites: async () => ({
      siteEntry: [{ siteUrl: "sc-domain:example.com" }],
    }),
    listSitemaps: async () => ({ sitemap: [] }),
    inspectUrl: async () => ({
      inspectionResult: { indexStatusResult: { verdict: "PASS" } },
    }),
    querySearchAnalytics: async () => ({ rows: [] }),
  } as unknown as SearchConsoleClient;
  const server = createServer(api);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
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
  } finally {
    await client.close();
    await server.close();
  }
});
