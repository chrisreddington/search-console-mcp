import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  COMPARABLE_DIMENSIONS,
  COMPARISON_OPERATORS,
  METRIC_FIELDS,
  RETRIEVAL_MODES,
  createComparer,
} from "./analytics-compare.js";
import { createAuthorizedClient } from "./auth.js";

import { SearchConsoleClient } from "./google-client.js";
import { PACKAGE_VERSION } from "./package-version.js";
import { resolveClientCredentials } from "./secrets.js";
import { createTokenStore } from "./token-store.js";

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

const metricFilter = z.object({
  field: z.enum(METRIC_FIELDS),
  operator: z.enum(COMPARISON_OPERATORS),
  value: z.number(),
});

// Shared by gsc_query_search_analytics and gsc_compare_search_analytics, which
// both retrieve from the same Search Analytics API and so share its shape.
const searchFilter = z.object({
  dimension: filterDimension,
  operator: filterOperator.default("equals"),
  expression: z.string().min(1).max(4096),
});
const analyticsType = z
  .enum(["discover", "googleNews", "image", "news", "video", "web"])
  .default("web");
const aggregationType = z
  .enum(["auto", "byPage", "byProperty"])
  .default("auto");
const dataState = z.enum(["all", "final", "hourly_all"]).default("final");

export function createServer(client: SearchConsoleClient): McpServer {
  const server = new McpServer({
    name: "search-console",
    version: PACKAGE_VERSION,
  });
  // One comparer per server, so its acquisition cache lives as long as the session.
  const comparer = createComparer(client);
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
        filters: z.array(searchFilter).optional(),
        type: analyticsType,
        aggregationType,
        dataState,
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
    "gsc_compare_search_analytics",
    {
      description:
        "Compare two Search Analytics windows for one grain, returning union-joined rows with " +
        "current, prior, and delta metrics, plus coverage metadata. Filtering, sorting, and the " +
        "row limit are applied after retrieval, and a retrieval is cached for the session, so " +
        "repeat calls that change only those need no further API requests. Retrieval is never " +
        "guaranteed complete: read the returned coverage before characterising the result.",
      inputSchema: {
        siteUrl: z
          .string()
          .min(1)
          .describe(
            "Exact property identifier, such as sc-domain:example.com.",
          ),
        currentStartDate: isoDate("Inclusive start of the current window."),
        currentEndDate: isoDate("Inclusive end of the current window."),
        priorStartDate: isoDate("Inclusive start of the comparison window."),
        priorEndDate: isoDate("Inclusive end of the comparison window."),
        dimensions: z
          .array(z.enum(COMPARABLE_DIMENSIONS))
          .max(4)
          .optional()
          .describe(
            "Grain to compare. Time dimensions are unavailable here, because a date key " +
              "cannot appear in both windows.",
          ),
        filters: z
          .array(searchFilter)
          .optional()
          .describe(
            "API-side dimension filters. These narrow what Google returns, so they change " +
              "the retrieval rather than the post-retrieval selection.",
          ),
        type: analyticsType,
        aggregationType,
        dataState,
        retrievalMode: z
          .enum(RETRIEVAL_MODES)
          .default("range")
          .describe(
            "range: one paginated request per window; Google aggregates the whole window and " +
              "the metrics are its own. daily: one paginated request per day, aggregated " +
              "locally, which trades a larger row budget for locally derived metrics. Never " +
              "mix metrics from the two modes in one figure.",
          ),
        maxRowsPerRequest: z.number().int().min(1).max(25_000).default(25_000),
        where: z
          .array(metricFilter)
          .optional()
          .describe(
            "Metric thresholds applied to joined rows, combined with AND. A row whose " +
              "referenced side is absent has an unknown value and is excluded.",
          ),
        sort: z
          .array(
            z.object({
              field: z.enum(METRIC_FIELDS),
              direction: z.enum(["asc", "desc"]).default("desc"),
            }),
          )
          .optional()
          .describe(
            "Applied after filtering. A negative delta.position means position improved.",
          ),
        limit: z.number().int().min(1).max(5_000).default(100),
      },
      annotations: readOnlyAnnotations,
    },
    (input) =>
      result(
        comparer.compare({
          siteUrl: input.siteUrl,
          current: {
            startDate: input.currentStartDate,
            endDate: input.currentEndDate,
          },
          prior: {
            startDate: input.priorStartDate,
            endDate: input.priorEndDate,
          },
          dimensions: input.dimensions,
          filters: input.filters,
          type: input.type,
          aggregationType: input.aggregationType,
          dataState: input.dataState,
          retrievalMode: input.retrievalMode,
          maxRowsPerRequest: input.maxRowsPerRequest,
          where: input.where,
          sort: input.sort,
          limit: input.limit,
        }),
      ),
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
  const tokenStore = createTokenStore();
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
