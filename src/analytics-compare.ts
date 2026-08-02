import type {
  SearchAnalyticsAggregationType,
  SearchAnalyticsDataState,
  SearchAnalyticsFilter,
  SearchAnalyticsQuery,
  SearchAnalyticsType,
} from "./google-client.js";

/**
 * Time dimensions are excluded deliberately. Comparing two windows keyed by date
 * or hour produces rows that can never join, because no key appears in both.
 */
export const COMPARABLE_DIMENSIONS = [
  "country",
  "device",
  "page",
  "query",
  "searchAppearance",
] as const;
export type ComparableDimension = (typeof COMPARABLE_DIMENSIONS)[number];

export const RETRIEVAL_MODES = ["range", "daily"] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export const METRIC_FIELDS = [
  "current.clicks",
  "current.impressions",
  "current.ctr",
  "current.position",
  "prior.clicks",
  "prior.impressions",
  "prior.ctr",
  "prior.position",
  "delta.clicks",
  "delta.impressions",
  "delta.ctr",
  "delta.position",
] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

export const COMPARISON_OPERATORS = ["gt", "gte", "lt", "lte"] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/** Google's own ceiling is 25,000 rows per response. */
const MAX_ROWS_PER_REQUEST = 25_000;

/**
 * Daily retrieval costs one paginated request per day per window, so an
 * accidentally wide window turns into hundreds of API calls.
 */
const MAX_DAILY_WINDOW_DAYS = 92;

const DEFAULT_MAX_CACHE_ENTRIES = 32;

const MILLISECONDS_PER_DAY = 86_400_000;

const COVERAGE_CAVEAT =
  "Search Analytics returns click-sorted top rows and does not guarantee every row, " +
  "nor report a true total. rowCapReached: true proves the result is truncated; " +
  "rowCapReached: false does not prove it is complete. Detailed query data also omits " +
  "anonymised queries. Never describe any retrieval here as exhaustive.";

export interface Metrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface DateWindow {
  startDate: string;
  endDate: string;
}

export interface WindowCoverage {
  retrievalMode: RetrievalMode;
  requests: number;
  rowsFetched: number;
  distinctKeys: number;
  /** Every request returned a short page, so no further rows were offered. */
  paginationExhausted: boolean;
  rowCapReached: boolean;
  /** Daily mode only: the dates whose own pagination hit the row ceiling. */
  rowCapReachedDates: string[];
  failedDates: Array<{ date: string; error: string }>;
}

export interface ComparedRow {
  keys: string[];
  current: Metrics | null;
  prior: Metrics | null;
  /**
   * Present only when the key appears in both windows. A negative
   * `delta.position` means the average position improved.
   */
  delta: Metrics | null;
}

export interface MetricFilter {
  field: MetricField;
  operator: ComparisonOperator;
  value: number;
}

export interface SortKey {
  field: MetricField;
  direction: "asc" | "desc";
}

export interface CompareRequest {
  siteUrl: string;
  current: DateWindow;
  prior: DateWindow;
  dimensions?: readonly ComparableDimension[] | undefined;
  filters?: readonly SearchAnalyticsFilter[] | undefined;
  type?: SearchAnalyticsType | undefined;
  aggregationType?: SearchAnalyticsAggregationType | undefined;
  dataState?: SearchAnalyticsDataState | undefined;
  retrievalMode?: RetrievalMode | undefined;
  maxRowsPerRequest?: number | undefined;
  where?: readonly MetricFilter[] | undefined;
  sort?: readonly SortKey[] | undefined;
  limit?: number | undefined;
}

export interface CompareResult {
  windows: { current: DateWindow; prior: DateWindow };
  retrievalMode: RetrievalMode;
  dimensions: string[];
  coverage: {
    current: WindowCoverage;
    prior: WindowCoverage;
    caveat: string;
  };
  counts: { unionKeys: number; matchedFilters: number; returned: number };
  rows: ComparedRow[];
}

/** The seam the comparer needs; `SearchConsoleClient` satisfies it structurally. */
export interface SearchAnalyticsSource {
  querySearchAnalytics(input: SearchAnalyticsQuery): Promise<unknown>;
}

export interface Comparer {
  compare(request: CompareRequest): Promise<CompareResult>;
}

interface AcquisitionSpec {
  siteUrl: string;
  window: DateWindow;
  dimensions: readonly ComparableDimension[];
  filters: readonly SearchAnalyticsFilter[];
  type: SearchAnalyticsType;
  aggregationType: SearchAnalyticsAggregationType;
  dataState: SearchAnalyticsDataState;
  retrievalMode: RetrievalMode;
  maxRowsPerRequest: number;
}

interface WindowDataset {
  metricsByKey: Map<string, { keys: string[]; metrics: Metrics }>;
  coverage: WindowCoverage;
}

/**
 * Caches acquisition by the inputs Google actually sees, so the skill can run
 * many analyses over one retrieval. Metric filtering, sorting, and limits are
 * applied to cached rows and are therefore deliberately absent from the key.
 */
export function createComparer(
  source: SearchAnalyticsSource,
  options: { maxCacheEntries?: number } = {},
): Comparer {
  const maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  const cache = new Map<string, Promise<WindowDataset>>();

  async function dataset(spec: AcquisitionSpec): Promise<WindowDataset> {
    const key = cacheKey(spec);
    const cached = cache.get(key);
    if (cached) return cached;

    const pending = acquire(source, spec);
    cache.set(key, pending);
    if (cache.size > maxCacheEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }

    try {
      return await pending;
    } catch (error) {
      // A failed acquisition must not poison later calls with the same spec.
      cache.delete(key);
      throw error;
    }
  }

  return {
    async compare(request: CompareRequest): Promise<CompareResult> {
      const shared = sharedSpec(request);
      const [current, prior] = await Promise.all([
        dataset({ ...shared, window: request.current }),
        dataset({ ...shared, window: request.prior }),
      ]);

      const joined = join(current, prior);
      const matched = joined.filter((row) => matchesAll(row, request.where));
      const sorted = sortRows(matched, request.sort);
      const limit = clamp(request.limit ?? 100, 1, 5_000);

      return {
        windows: { current: request.current, prior: request.prior },
        retrievalMode: shared.retrievalMode,
        dimensions: [...shared.dimensions],
        coverage: {
          current: current.coverage,
          prior: prior.coverage,
          caveat: COVERAGE_CAVEAT,
        },
        counts: {
          unionKeys: joined.length,
          matchedFilters: matched.length,
          returned: Math.min(limit, sorted.length),
        },
        rows: sorted.slice(0, limit),
      };
    },
  };
}

function sharedSpec(request: CompareRequest): Omit<AcquisitionSpec, "window"> {
  return {
    siteUrl: request.siteUrl,
    dimensions: request.dimensions ?? [],
    filters: request.filters ?? [],
    type: request.type ?? "web",
    aggregationType: request.aggregationType ?? "auto",
    dataState: request.dataState ?? "final",
    retrievalMode: request.retrievalMode ?? "range",
    maxRowsPerRequest: clamp(
      request.maxRowsPerRequest ?? MAX_ROWS_PER_REQUEST,
      1,
      MAX_ROWS_PER_REQUEST,
    ),
  };
}

function cacheKey(spec: AcquisitionSpec): string {
  return JSON.stringify([
    spec.siteUrl,
    spec.window.startDate,
    spec.window.endDate,
    spec.dimensions,
    spec.filters.map((filter) => [
      filter.dimension,
      filter.operator ?? "equals",
      filter.expression,
    ]),
    spec.type,
    spec.aggregationType,
    spec.dataState,
    spec.retrievalMode,
    spec.maxRowsPerRequest,
  ]);
}

async function acquire(
  source: SearchAnalyticsSource,
  spec: AcquisitionSpec,
): Promise<WindowDataset> {
  const days =
    spec.retrievalMode === "daily" ? datesInWindow(spec.window) : [spec.window];

  if (spec.retrievalMode === "daily" && days.length > MAX_DAILY_WINDOW_DAYS) {
    throw new Error(
      `Daily retrieval covers at most ${MAX_DAILY_WINDOW_DAYS} days and this window is ${days.length}. ` +
        "Narrow the window or use retrievalMode: range.",
    );
  }

  const accumulators = new Map<string, Accumulator>();
  const coverage: WindowCoverage = {
    retrievalMode: spec.retrievalMode,
    requests: 0,
    rowsFetched: 0,
    distinctKeys: 0,
    paginationExhausted: true,
    rowCapReached: false,
    rowCapReachedDates: [],
    failedDates: [],
  };

  for (const day of days) {
    coverage.requests += 1;
    let response: unknown;
    try {
      response = await source.querySearchAnalytics({
        siteUrl: spec.siteUrl,
        startDate: day.startDate,
        endDate: day.endDate,
        dimensions: spec.dimensions,
        filters: spec.filters,
        type: spec.type,
        aggregationType: spec.aggregationType,
        dataState: spec.dataState,
        pageSize: spec.maxRowsPerRequest,
        allPages: true,
        maxRows: spec.maxRowsPerRequest,
      });
    } catch (error) {
      // One bad day must not discard the rest of the window; record and continue.
      coverage.failedDates.push({
        date: day.startDate,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      coverage.paginationExhausted = false;
      continue;
    }

    const { rows, truncated } = readResponse(response);
    coverage.rowsFetched += rows.length;
    if (truncated) {
      coverage.rowCapReached = true;
      coverage.paginationExhausted = false;
      coverage.rowCapReachedDates.push(day.startDate);
    }
    for (const row of rows) accumulate(accumulators, row);
  }

  const firstFailure = coverage.failedDates[0];
  if (firstFailure && coverage.failedDates.length === days.length) {
    // Nothing survived, so an empty dataset would read as "no search demand"
    // rather than "the API refused us". Surface the cause instead.
    throw new Error(
      `Retrieval failed for every request covering ${spec.window.startDate}..${spec.window.endDate}: ${firstFailure.error}`,
    );
  }

  const metricsByKey = new Map<string, { keys: string[]; metrics: Metrics }>();
  for (const [key, accumulator] of accumulators) {
    metricsByKey.set(key, {
      keys: accumulator.keys,
      metrics: finalise(accumulator),
    });
  }
  coverage.distinctKeys = metricsByKey.size;

  return { metricsByKey, coverage };
}

interface Accumulator {
  keys: string[];
  clicks: number;
  impressions: number;
  weightedPositionSum: number;
  plainPositionSum: number;
  rowCount: number;
}

function accumulate(accumulators: Map<string, Accumulator>, row: ApiRow): void {
  const key = row.keys.join(" ");
  const existing = accumulators.get(key) ?? {
    keys: row.keys,
    clicks: 0,
    impressions: 0,
    weightedPositionSum: 0,
    plainPositionSum: 0,
    rowCount: 0,
  };

  existing.clicks += row.clicks;
  existing.impressions += row.impressions;
  existing.weightedPositionSum += row.position * row.impressions;
  existing.plainPositionSum += row.position;
  existing.rowCount += 1;
  accumulators.set(key, existing);
}

/**
 * CTR is always recomputed from summed clicks and impressions, and position is
 * impression-weighted. Averaging Google's per-day rates would weight a day with
 * three impressions the same as a day with three thousand.
 */
function finalise(accumulator: Accumulator): Metrics {
  const position =
    accumulator.impressions > 0
      ? accumulator.weightedPositionSum / accumulator.impressions
      : safeDivide(accumulator.plainPositionSum, accumulator.rowCount);

  return {
    clicks: accumulator.clicks,
    impressions: accumulator.impressions,
    ctr: safeDivide(accumulator.clicks, accumulator.impressions),
    position,
  };
}

function join(current: WindowDataset, prior: WindowDataset): ComparedRow[] {
  const keys = new Set([
    ...current.metricsByKey.keys(),
    ...prior.metricsByKey.keys(),
  ]);

  const rows: ComparedRow[] = [];
  for (const key of keys) {
    const currentEntry = current.metricsByKey.get(key);
    const priorEntry = prior.metricsByKey.get(key);
    const currentMetrics = currentEntry?.metrics ?? null;
    const priorMetrics = priorEntry?.metrics ?? null;

    rows.push({
      keys: currentEntry?.keys ?? priorEntry?.keys ?? [],
      current: currentMetrics,
      prior: priorMetrics,
      // Absence from a window is unknown, not zero, so the delta stays null.
      delta:
        currentMetrics && priorMetrics
          ? {
              clicks: currentMetrics.clicks - priorMetrics.clicks,
              impressions:
                currentMetrics.impressions - priorMetrics.impressions,
              ctr: currentMetrics.ctr - priorMetrics.ctr,
              position: currentMetrics.position - priorMetrics.position,
            }
          : null,
    });
  }
  return rows;
}

function metricValue(row: ComparedRow, field: MetricField): number | null {
  const [side, metric] = field.split(".");
  const metrics =
    side === "current" ? row.current : side === "prior" ? row.prior : row.delta;
  if (!metrics) return null;
  if (metric === "clicks") return metrics.clicks;
  if (metric === "impressions") return metrics.impressions;
  if (metric === "ctr") return metrics.ctr;
  return metrics.position;
}

function matchesAll(
  row: ComparedRow,
  filters: readonly MetricFilter[] | undefined,
): boolean {
  if (!filters) return true;
  return filters.every((filter) => {
    const value = metricValue(row, filter.field);
    // An unknown metric cannot satisfy a threshold, so a null side is excluded.
    if (value === null) return false;
    if (filter.operator === "gt") return value > filter.value;
    if (filter.operator === "gte") return value >= filter.value;
    if (filter.operator === "lt") return value < filter.value;
    return value <= filter.value;
  });
}

function sortRows(
  rows: ComparedRow[],
  sort: readonly SortKey[] | undefined,
): ComparedRow[] {
  if (!sort || sort.length === 0) return rows;

  return [...rows].sort((left, right) => {
    for (const key of sort) {
      const leftValue = metricValue(left, key.field);
      const rightValue = metricValue(right, key.field);
      if (leftValue === rightValue) continue;
      // Rows missing the metric sort last whichever direction was asked for.
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return key.direction === "asc"
        ? leftValue - rightValue
        : rightValue - leftValue;
    }
    return 0;
  });
}

interface ApiRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function readResponse(response: unknown): {
  rows: ApiRow[];
  truncated: boolean;
} {
  if (!isRecord(response)) return { rows: [], truncated: false };

  const rows: ApiRow[] = [];
  if (Array.isArray(response.rows)) {
    for (const candidate of response.rows) {
      const row = toApiRow(candidate);
      if (row) rows.push(row);
    }
  }

  const pagination = response.pagination;
  const truncated = isRecord(pagination) && pagination.truncated === true;
  return { rows, truncated };
}

function toApiRow(value: unknown): ApiRow | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Array.isArray(value.keys)
    ? value.keys.filter((key): key is string => typeof key === "string")
    : [];

  return {
    keys,
    clicks: finiteNumber(value.clicks),
    impressions: finiteNumber(value.impressions),
    ctr: finiteNumber(value.ctr),
    position: finiteNumber(value.position),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Expands an inclusive window into one single-day window per calendar day. */
function datesInWindow(window: DateWindow): DateWindow[] {
  const start = parseIsoDate(window.startDate);
  const end = parseIsoDate(window.endDate);
  if (end < start) {
    throw new Error(
      `Window ${window.startDate}..${window.endDate} ends before it starts.`,
    );
  }

  const days: DateWindow[] = [];
  for (let day = start; day <= end; day += MILLISECONDS_PER_DAY) {
    const date = new Date(day).toISOString().slice(0, 10);
    days.push({ startDate: date, endDate: date });
  }
  return days;
}

function parseIsoDate(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected a YYYY-MM-DD date, received "${value}".`);
  }
  return parsed;
}
