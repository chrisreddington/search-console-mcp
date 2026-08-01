import type { OAuth2Client } from "google-auth-library";
import { accessToken } from "./auth.js";
import { TokenStore } from "./token-store.js";

export interface SearchAnalyticsFilter {
  dimension: "country" | "device" | "page" | "query" | "searchAppearance";
  operator?:
    | "contains"
    | "equals"
    | "notContains"
    | "notEquals"
    | "includingRegex"
    | "excludingRegex";
  expression: string;
}

export interface SearchAnalyticsQuery {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?:
    | Array<
        | "country"
        | "date"
        | "device"
        | "hour"
        | "page"
        | "query"
        | "searchAppearance"
      >
    | undefined;
  filters?: SearchAnalyticsFilter[] | undefined;
  type?:
    "discover" | "googleNews" | "image" | "news" | "video" | "web" | undefined;
  aggregationType?: "auto" | "byPage" | "byProperty" | undefined;
  dataState?: "all" | "final" | "hourly_all" | undefined;
  pageSize?: number | undefined;
  startRow?: number | undefined;
  allPages?: boolean | undefined;
  maxRows?: number | undefined;
}

export interface ApiOptions {
  baseUrl?: string;
  inspectionBaseUrl?: string;
  fetch?: typeof fetch;
}

export class SearchConsoleClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly baseUrl: string;
  private readonly inspectionBaseUrl: string;

  public constructor(
    private readonly auth: OAuth2Client,
    private readonly tokenStore: TokenStore,
    options: ApiOptions = {},
  ) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.baseUrl =
      options.baseUrl ?? "https://www.googleapis.com/webmasters/v3";
    this.inspectionBaseUrl =
      options.inspectionBaseUrl ?? "https://searchconsole.googleapis.com/v1";
  }

  public async listSites(): Promise<unknown> {
    return this.request(`${this.baseUrl}/sites`);
  }

  public async listSitemaps(
    siteUrl: string,
    sitemapIndex?: string,
  ): Promise<unknown> {
    const query = sitemapIndex
      ? `?sitemapIndex=${encodeURIComponent(sitemapIndex)}`
      : "";
    return this.request(
      `${this.baseUrl}/sites/${encodeURIComponent(siteUrl)}/sitemaps${query}`,
    );
  }

  public async inspectUrl(
    siteUrl: string,
    inspectionUrl: string,
    languageCode = "en-US",
  ): Promise<unknown> {
    return this.request(
      `${this.inspectionBaseUrl}/urlInspection/index:inspect`,
      {
        method: "POST",
        body: JSON.stringify({ siteUrl, inspectionUrl, languageCode }),
      },
    );
  }

  public async querySearchAnalytics(
    input: SearchAnalyticsQuery,
  ): Promise<unknown> {
    const pageSize = Math.min(Math.max(input.pageSize ?? 1_000, 1), 25_000);
    const maxRows = Math.min(Math.max(input.maxRows ?? 25_000, 1), 50_000);
    let startRow = Math.max(input.startRow ?? 0, 0);
    const rows: unknown[] = [];
    let finalResponse: Record<string, unknown> = {};

    do {
      const response = await this.request<Record<string, unknown>>(
        `${this.baseUrl}/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: input.dimensions,
            type: input.type ?? "web",
            aggregationType: input.aggregationType ?? "auto",
            dataState: input.dataState ?? "final",
            dimensionFilterGroups: input.filters?.length
              ? [{ groupType: "and", filters: input.filters }]
              : undefined,
            rowLimit: Math.min(pageSize, maxRows - rows.length),
            startRow,
          }),
        },
      );
      finalResponse = response;
      const pageRows = Array.isArray(response.rows) ? response.rows : [];
      rows.push(...pageRows);
      startRow += pageRows.length;

      if (
        !input.allPages ||
        pageRows.length < pageSize ||
        rows.length >= maxRows
      )
        break;
    } while (true);

    return {
      ...finalResponse,
      rows,
      pagination: {
        returnedRows: rows.length,
        nextStartRow: startRow,
        truncated: input.allPages === true && rows.length >= maxRows,
      },
    };
  }

  private async request<T = unknown>(
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = await accessToken(this.auth, this.tokenStore);

    // Headers merges every HeadersInit shape; spreading would silently drop
    // caller headers supplied as a Headers instance or an entry array.
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await this.fetchImplementation(url, { ...init, headers });

    if (!response.ok) {
      const detail = await safeErrorDetail(response);
      throw new Error(
        `Search Console API request failed (${response.status}): ${detail}`,
      );
    }
    return (await response.json()) as T;
  }
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown; status?: unknown };
    };
    if (typeof body.error?.message === "string") return body.error.message;
    if (typeof body.error?.status === "string") return body.error.status;
  } catch {
    // Do not echo arbitrary response bodies; they can contain request details.
  }
  return response.statusText || "Unknown API error";
}
