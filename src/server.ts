import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createAuthorizedClient } from "./auth.js";
import { resolveTokenFile } from "./config.js";
import { SearchConsoleClient } from "./google-client.js";
import { resolveClientCredentials } from "./secrets.js";
import { TokenStore } from "./token-store.js";

const dimension = z.enum([
  "country",
  "date",
  "device",
  "hour",
  "page",
  "query",
  "searchAppearance",
]);
const filterDimension = z.enum([
  "country",
  "device",
  "page",
  "query",
  "searchAppearance",
]);
const filterOperator = z.enum([
  "contains",
  "equals",
  "notContains",
  "notEquals",
  "includingRegex",
  "excludingRegex",
]);

export function createServer(client: SearchConsoleClient): McpServer {
  const server = new McpServer({ name: "search-console", version: "0.1.0" });
  const readOnlyAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  server.registerTool(
    "gsc_list_sites",
    {
      description:
        "List Search Console properties available to the authenticated account.",
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    () => result(client.listSites()),
  );

  server.registerTool(
    "gsc_query_search_analytics",
    {
      description:
        "Query Search Analytics with dimensions and filters. Defaults to finalized Web data and 1,000 rows; opt into pagination explicitly.",
      inputSchema: {
        siteUrl: z
          .string()
          .min(1)
          .describe(
            "Exact property identifier, such as sc-domain:example.com.",
          ),
        startDate: isoDate("Inclusive start date in America/Los_Angeles time."),
        endDate: isoDate("Inclusive end date in America/Los_Angeles time."),
        dimensions: z.array(dimension).max(7).optional(),
        filters: z
          .array(
            z.object({
              dimension: filterDimension,
              operator: filterOperator.default("equals"),
              expression: z.string().min(1).max(4096),
            }),
          )
          .optional(),
        type: z
          .enum(["discover", "googleNews", "image", "news", "video", "web"])
          .default("web"),
        aggregationType: z
          .enum(["auto", "byPage", "byProperty"])
          .default("auto"),
        dataState: z.enum(["all", "final", "hourly_all"]).default("final"),
        pageSize: z.number().int().min(1).max(25_000).default(1_000),
        startRow: z.number().int().min(0).default(0),
        allPages: z.boolean().default(false),
        maxRows: z.number().int().min(1).max(50_000).default(25_000),
      },
      annotations: readOnlyAnnotations,
    },
    (input) => result(client.querySearchAnalytics(input)),
  );

  server.registerTool(
    "gsc_list_sitemaps",
    {
      description: "List sitemaps submitted for a Search Console property.",
      inputSchema: {
        siteUrl: z.string().min(1),
        sitemapIndex: z.string().url().optional(),
      },
      annotations: readOnlyAnnotations,
    },
    ({ siteUrl, sitemapIndex }) =>
      result(client.listSitemaps(siteUrl, sitemapIndex)),
  );

  server.registerTool(
    "gsc_inspect_url",
    {
      description:
        "Inspect Google's indexed version of a URL. This does not perform a live test or request indexing.",
      inputSchema: {
        siteUrl: z.string().min(1),
        inspectionUrl: z.string().url(),
        languageCode: z
          .string()
          .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)
          .default("en-US"),
      },
      annotations: readOnlyAnnotations,
    },
    ({ siteUrl, inspectionUrl, languageCode }) =>
      result(client.inspectUrl(siteUrl, inspectionUrl, languageCode)),
  );

  return server;
}

function isoDate(description: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .describe(description);
}

async function result(operation: Promise<unknown>) {
  try {
    const value = await operation;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(value, null, 2) },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            error instanceof Error
              ? error.message
              : "Search Console request failed.",
        },
      ],
    };
  }
}

async function main(): Promise<void> {
  const tokenStore = new TokenStore(resolveTokenFile());
  const credentials = await resolveClientCredentials();
  const auth = await createAuthorizedClient(credentials, tokenStore);
  const server = createServer(new SearchConsoleClient(auth, tokenStore));
  await server.connect(new StdioServerTransport());
}

// pathToFileURL matches import.meta.url's percent-encoding, so the server still
// starts from a path containing spaces or non-ASCII characters.
const entrypoint = argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Search Console MCP failed to start."}\n`,
    );
    process.exitCode = 1;
  });
}
