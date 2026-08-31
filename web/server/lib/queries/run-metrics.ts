/**
 * Shared query function for fetching run metrics from ClickHouse.
 * Used by both tRPC procedures and OpenAPI endpoints.
 */

import type { clickhouse } from "../clickhouse";
import { getLogGroupName } from "../utilts";

/** Server-side downsampling algorithm. "avg" = fixed-width buckets with
 *  avg/min/max aggregation. "lttb" = Largest Triangle Three Buckets —
 *  selects visually representative points that preserve curve shape. */
export type DownsamplingAlgorithm = "avg" | "lttb";

// Maximum number of data points to return per metric series.
// The server does bucketed downsampling with min/max envelope rendering,
// so 10k points is enough for high-quality charts.
// This keeps individual metric responses under ~500KB uncompressed.
const DEFAULT_MAX_POINTS = 10_000;

// SQL fragment: extract non-finite type as valueFlag BEFORE JSON serialization
// converts NaN/Inf/-Inf to null. We leave `value` unaliased — ClickHouse JSON
// will serialize non-finite values as null, which we sanitize to 0 in TypeScript.
const VALUE_FLAG_SELECT = `multiIf(isNaN(value), 'NaN', isInfinite(value) AND value > 0, 'Inf', isInfinite(value) AND value < 0, '-Inf', '') as valueFlag`;

/** Sanitize null values (from ClickHouse JSON serialization of NaN/Inf/-Inf) to 0 */
function sanitizeMetricRows<T extends { value: number | null }>(rows: T[]): T[] {
  for (const row of rows) {
    if (row.value === null || row.value === undefined) {
      (row as { value: number }).value = 0;
    }
  }
  return rows;
}

export interface QueryRunMetricsParams {
  organizationId: string;
  projectName: string;
  runId: number;
  logName?: string;
  logGroup?: string;
  limit?: number;
  stepMin?: number;
  stepMax?: number;
}

export interface RunMetricEntry {
  logName: string;
  logGroup: string;
  value: number;
  valueFlag: string;
  time: string;
  step: number;
}

/** Data point returned by single-run and batch graph queries */
export interface MetricDataPoint {
  value: number;
  valueFlag: string;
  time: string;
  step: number;
}

/**
 * Query metrics from a run with reservoir sampling.
 * Supports filtering by logName and/or logGroup.
 * Uses reservoir sampling to limit data points while maintaining distribution.
 */
export async function queryRunMetrics(
  ch: typeof clickhouse,
  params: QueryRunMetricsParams
): Promise<RunMetricEntry[]> {
  const {
    organizationId,
    projectName,
    runId,
    logName,
    logGroup,
    limit = DEFAULT_MAX_POINTS,
    stepMin,
    stepMax,
  } = params;

  // Build where clause
  let whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
  `;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runId,
  };

  if (logName) {
    whereClause += ` AND logName = {logName: String}`;
    queryParams.logName = logName;
  }

  if (logGroup) {
    whereClause += ` AND logGroup = {logGroup: String}`;
    queryParams.logGroup = logGroup;
  }

  if (stepMin !== undefined) {
    whereClause += ` AND step >= {stepMin: UInt64}`;
    queryParams.stepMin = stepMin;
  }

  if (stepMax !== undefined) {
    whereClause += ` AND step <= {stepMax: UInt64}`;
    queryParams.stepMax = stepMax;
  }

  // Use reservoir sampling to limit results while maintaining distribution
  const query = `
    WITH counted AS (
      SELECT
        logName, logGroup, value, time, step,
        count() OVER (PARTITION BY logName) as total_rows,
        row_number() OVER (PARTITION BY logName ORDER BY step ASC) as rn
      FROM mlop_metrics_v2 FINAL
      WHERE ${whereClause}
    )
    SELECT logName, logGroup, value, ${VALUE_FLAG_SELECT}, time, step
    FROM counted
    WHERE total_rows <= {limit: UInt32}
       OR rn % ceiling(total_rows / {limit: UInt32}) = 1
       OR rn = total_rows
    ORDER BY logName, step ASC
  `;
  queryParams.limit = limit;

  const result = await ch.query(query, queryParams);
  return sanitizeMetricRows((await result.json()) as RunMetricEntry[]);
}

/**
 * Query metrics for a single logName (used by tRPC graph procedure).
 * Returns data points with reservoir sampling applied.
 *
 * When stepMin/stepMax are provided, returns full-resolution data for that
 * range (up to DEFAULT_MAX_POINTS). This enables zoom-triggered re-fetch:
 * initial load gets a 10k-point overview, then zooming fetches full detail.
 */
export async function queryRunMetricsByLogName(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    logName: string;
    stepMin?: number;
    stepMax?: number;
    maxPoints?: number; // 0 = no limit (return all rows), undefined = DEFAULT_MAX_POINTS
    preview?: boolean; // When true, use fast LIMIT instead of reservoir sampling
  }
): Promise<MetricDataPoint[]> {
  const { organizationId, projectName, runId, logName, stepMin, stepMax, maxPoints, preview } = params;
  const logGroup = getLogGroupName(logName);
  const effectiveLimit = maxPoints === undefined ? DEFAULT_MAX_POINTS : maxPoints;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runId,
    logName,
    logGroup,
  };

  // When step range is provided, return data for that range.
  if (stepMin !== undefined && stepMax !== undefined) {
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;

    // When maxPoints=0, skip reservoir sampling entirely — return all rows in range
    if (effectiveLimit === 0) {
      const query = `
        SELECT value, ${VALUE_FLAG_SELECT}, time, step
        FROM mlop_metrics_v2 FINAL
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
          AND step >= {stepMin: UInt64}
          AND step <= {stepMax: UInt64}
        ORDER BY step ASC
      `;
      const result = await ch.query(query, queryParams);
      return sanitizeMetricRows((await result.json()) as MetricDataPoint[]);
    }

    // Fast preview path for step ranges: stride-based sampling, no window functions.
    // Selects every Nth step across the full zoom range so data appears everywhere
    // at once rather than filling in left-to-right (which LIMIT would do).
    if (preview && effectiveLimit > 0) {
      const query = `
        SELECT value, ${VALUE_FLAG_SELECT}, time, step
        FROM mlop_metrics_v2 FINAL
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
          AND step >= {stepMin: UInt64}
          AND step <= {stepMax: UInt64}
          AND (step - {stepMin: UInt64}) % greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64}, toUInt64(${effectiveLimit}))) = 0
        ORDER BY step ASC
      `;
      const result = await ch.query(query, queryParams);
      return sanitizeMetricRows((await result.json()) as MetricDataPoint[]);
    }

    // Uses reservoir sampling when the range has more points than the limit,
    // ensuring the returned data always spans the full requested range.
    const query = `
      WITH counted AS (
        SELECT
          value, time, step,
          count() OVER () as total_rows,
          row_number() OVER (ORDER BY step ASC) as rn
        FROM mlop_metrics_v2 FINAL
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
          AND step >= {stepMin: UInt64}
          AND step <= {stepMax: UInt64}
      )
      SELECT value, ${VALUE_FLAG_SELECT}, time, step
      FROM counted
      WHERE total_rows <= ${effectiveLimit}
         OR rn % ceiling(total_rows / ${effectiveLimit}) = 1
         OR rn = total_rows
      ORDER BY step ASC
    `;

    const result = await ch.query(query, queryParams);
    return sanitizeMetricRows((await result.json()) as MetricDataPoint[]);
  }

  // Overview query: when maxPoints=0, return all data without sampling
  if (effectiveLimit === 0) {
    const query = `
      SELECT value, ${VALUE_FLAG_SELECT}, time, step
      FROM mlop_metrics_v2 FINAL
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND runId = {runId: UInt64}
        AND logName = {logName: String}
        AND logGroup = {logGroup: String}
      ORDER BY step ASC
    `;
    const result = await ch.query(query, queryParams);
    return sanitizeMetricRows((await result.json()) as MetricDataPoint[]);
  }

  // Fast preview path: simple LIMIT scan using primary key index, no window functions.
  // Returns the first N chronological points — good enough for a quick shape preview
  // that gets replaced by properly-sampled data moments later.
  if (preview && effectiveLimit > 0) {
    const query = `
      SELECT value, ${VALUE_FLAG_SELECT}, time, step
      FROM mlop_metrics_v2 FINAL
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND runId = {runId: UInt64}
        AND logName = {logName: String}
        AND logGroup = {logGroup: String}
      ORDER BY step ASC
      LIMIT ${effectiveLimit}
    `;
    const result = await ch.query(query, queryParams);
    return sanitizeMetricRows((await result.json()) as MetricDataPoint[]);
  }

  // Overview query: reservoir sampling to fit within the effective limit
  const query = `
    WITH counted AS (
      SELECT
        value, time, step,
        count() OVER () as total_rows,
        row_number() OVER (ORDER BY step ASC) as rn
      FROM mlop_metrics_v2 FINAL
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND runId = {runId: UInt64}
        AND logName = {logName: String}
        AND logGroup = {logGroup: String}
    )
    SELECT value, ${VALUE_FLAG_SELECT}, time, step
    FROM counted
    WHERE total_rows <= ${effectiveLimit}
       OR rn % ceiling(total_rows / ${effectiveLimit}) = 1
       OR rn = total_rows
    ORDER BY step ASC
  `;

  const result = await ch.query(query, queryParams);
  return sanitizeMetricRows((await result.json()) as MetricDataPoint[]);
}

/**
 * Batch query metrics for multiple runs by logName in a SINGLE ClickHouse query.
 * Returns a map of runId → data points.
 *
 * This reduces N individual queries (one per run) to 1 query, which is critical
 * for comparison pages with 50-100 runs × multiple charts.
 */
/** Data point returned by bucketed graph queries */
export interface BucketedMetricDataPoint {
  step: number;       // min(step) in bucket — representative x
  time: string;       // time at first step in bucket
  value: number | null; // avg(finite values) — the line (null if all non-finite)
  minY: number | null;  // min(finite values) — envelope bottom (null if all non-finite)
  maxY: number | null;  // max(finite values) — envelope top (null if all non-finite)
  count: number;      // points in bucket
  nonFiniteFlags: number; // bitmask: bit0=hasNaN, bit1=hasInf(+), bit2=hasNegInf(-)
}

const DEFAULT_BUCKETS = 1000;
const PREVIEW_BUCKETS = 200;

/**
 * Bounds CTE body for batch queries with a single logName (no GROUP BY).
 * Always reads from mlop_metric_summaries_v2 — accepts up to ~5 min staleness
 * on the right edge for RUNNING runs (refresh interval).
 *
 * NULL handling: aggregate over an empty set returns one row of NULLs, so
 * `ifNull`/`coalesce` make the bounds degrade to (0, 1000) when no summary
 * row exists yet for the (run, metric) — happens during the brief window
 * after first ingest and before the first refresh tick lands.
 */
function buildSummaryBoundsBodySingleMetric(logNameFilter: string): string {
  return `
    SELECT
      ifNull(min(min_step), toUInt64(0)) AS minStep,
      coalesce(nullIf(max(max_step), 0), toUInt64(1000)) AS maxStep
    FROM mlop_metric_summaries_v2
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND runId IN ({runIds: Array(UInt64)})
      ${logNameFilter}
  `;
}

/**
 * Bounds CTE body for multi-metric batch queries (one row per logName).
 *
 * Uses `arrayJoin({logNames})` LEFT JOINed against summaries so that every
 * requested logName always produces a bounds row — even if no summary row
 * exists yet. Without this, GROUP BY would silently drop missing metrics
 * and the downstream `INNER JOIN params p ON m.logName = p.logName` would
 * return zero rows for those metrics until the next refresh tick.
 */
function buildSummaryBoundsBodyMultiMetric(): string {
  return `
    SELECT
      lns.ln AS logName,
      ifNull(sb.rawMinStep, toUInt64(0)) AS minStep,
      coalesce(nullIf(sb.rawMaxStep, 0), toUInt64(1000)) AS maxStep
    FROM (SELECT arrayJoin({logNames: Array(String)}) AS ln) lns
    LEFT JOIN (
      SELECT logName, min(min_step) AS rawMinStep, max(max_step) AS rawMaxStep
      FROM mlop_metric_summaries_v2
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND runId IN ({runIds: Array(UInt64)})
        AND logName IN ({logNames: Array(String)})
      GROUP BY logName
    ) sb ON lns.ln = sb.logName
  `;
}

/**
 * Sanitize bucketed metric rows: null values (from ClickHouse JSON serialization
 * of NaN/Inf/-Inf) become 0 for value/minY/maxY. nonFiniteFlags is already a
 * UInt8 bitmask from ClickHouse (bit0=NaN, bit1=+Inf, bit2=-Inf).
 */
function sanitizeBucketedRows<T extends BucketedMetricDataPoint>(rows: T[]): T[] {
  for (const row of rows) {
    // Ensure nonFiniteFlags is a number (ClickHouse returns UInt8 as number in JSON)
    row.nonFiniteFlags = Number(row.nonFiniteFlags) || 0;
    // If value is null AND the bucket has non-finite flags, the bucket is all
    // non-finite — preserve null so the frontend can show flag text instead of "0".
    if (row.value == null && row.nonFiniteFlags !== 0) {
      // leave value/minY/maxY as null
    } else {
      row.value = row.value ?? 0;
      row.minY = row.minY ?? 0;
      row.maxY = row.maxY ?? 0;
    }
  }
  return rows;
}

/**
 * Query metrics for a single logName using server-side bucketed downsampling.
 * Returns N buckets with avg/min/max per bucket — enables envelope rendering
 * without client-side downsampling. ~10x less data transfer than raw point queries.
 *
 * When stepMin/stepMax are provided, buckets only the specified range.
 */
export async function queryRunMetricsBucketedByLogName(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    logName: string;
    buckets?: number;      // default: 1000 (standard), 200 (preview)
    stepMin?: number;
    stepMax?: number;
    preview?: boolean;
    algorithm?: DownsamplingAlgorithm;
  }
): Promise<BucketedMetricDataPoint[]> {
  const { organizationId, projectName, runId, logName, stepMin, stepMax, preview, algorithm } = params;

  if (algorithm === "lttb") {
    return queryRunMetricsBucketedByLogNameLttb(ch, params);
  }
  const logGroup = getLogGroupName(logName);
  const numBuckets = params.buckets ?? (preview ? PREVIEW_BUCKETS : DEFAULT_BUCKETS);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runId,
    logName,
    logGroup,
    numBuckets,
  };

  let whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    AND logName = {logName: String}
    AND logGroup = {logGroup: String}
  `;

  // Step range filters are built separately for CTE vs main query to avoid
  // ambiguity with the `step` SELECT alias (which is an aggregate).
  // In the bounds CTE there's no alias conflict; in the main query we use m.step.
  let boundsStepRange = "";
  let mainStepRange = "";
  if (stepMin !== undefined && stepMax !== undefined) {
    boundsStepRange = ` AND step >= {stepMin: UInt64} AND step <= {stepMax: UInt64}`;
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // Non-zoom path: read min/max step from mlop_metric_summaries
  // (refreshable MV, eventually consistent within ~5 min). RUNNING runs
  // can have bounds that lag the latest logged step by up to 5 min.
  // ifNull/nullIf handle the brief post-ingest / pre-refresh window where
  // no summary row exists yet (degrade to 0..1000 → bucketWidth=1).
  // Zoom path always uses raw v2 because the bucket width must reflect
  // the zoomed range.
  const boundsCte = stepMin === undefined || stepMax === undefined
    ? `bounds AS (
        SELECT
          ifNull(min(min_step), toUInt64(0)) AS minStep,
          coalesce(nullIf(max(max_step), 0), toUInt64(1000)) AS maxStep
        FROM mlop_metric_summaries_v2
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
      )`
    : `bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics_v2
        WHERE ${whereClause}${boundsStepRange}
      )`;

  const query = `
    WITH
      ${boundsCte}
    SELECT
      intDiv(m.step - b.minStep, greatest(toUInt64(1), intDiv(b.maxStep - b.minStep + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
      min(m.step) AS step,
      argMin(m.time, m.step) AS time,
      avgIf(m.value, isFinite(m.value)) AS value,
      minIf(m.value, isFinite(m.value)) AS minY,
      maxIf(m.value, isFinite(m.value)) AS maxY,
      toUInt64(count()) AS count,
      toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
    FROM mlop_metrics_v2 m FINAL
    CROSS JOIN bounds b
    WHERE ${whereClause}${mainStepRange}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const result = await ch.query(query, queryParams);
  return sanitizeBucketedRows((await result.json()) as BucketedMetricDataPoint[]);
}

/**
 * Batch query bucketed metrics for multiple runs by logName in a SINGLE ClickHouse query.
 * Returns a map of runId → bucketed data points.
 */
export async function queryRunMetricsBatchBucketedByLogName(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
    logName: string;
    buckets?: number;
    stepMin?: number;
    stepMax?: number;
    preview?: boolean;
    algorithm?: DownsamplingAlgorithm;
  }
): Promise<Record<number, BucketedMetricDataPoint[]>> {
  const { organizationId, projectName, runIds, logName, stepMin, stepMax, preview, algorithm } = params;

  if (runIds.length === 0) return {};

  if (algorithm === "lttb") {
    return queryRunMetricsBatchBucketedByLogNameLttb(ch, params);
  }

  const logGroup = getLogGroupName(logName);
  const numBuckets = params.buckets ?? (preview ? PREVIEW_BUCKETS : DEFAULT_BUCKETS);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    logName,
    logGroup,
    numBuckets,
  };

  let whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId IN ({runIds: Array(UInt64)})
    AND logName = {logName: String}
    AND logGroup = {logGroup: String}
  `;

  // Step range filters are built separately for CTE vs main query to avoid
  // ambiguity with the `step` SELECT alias (which is an aggregate).
  let boundsStepRange = "";
  let mainStepRange = "";
  if (stepMin !== undefined && stepMax !== undefined) {
    boundsStepRange = ` AND step >= {stepMin: UInt64} AND step <= {stepMax: UInt64}`;
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // PER-RUN bounds. Was: a single (min, max) across the union of all
  // selected runs, which forces every run to share the same bucket
  // width. With mixed run lengths (e.g. one 500K-step run + one
  // 200-step run, 1000 buckets), bucketWidth = 500 and the short run
  // collapses to ONE bucket → renders as a lone bucket-center dot
  // instead of a line. Computing min/max per run gives each run its
  // own bucket width tied to ITS data, so short runs draw as proper
  // lines.
  //
  // arrayJoin({runIds}) ensures every requested run produces a row
  // even before the summaries MV catches up for RUNNING runs (mirrors
  // the existing fallback pattern in buildSummaryBoundsBodyMultiMetric).
  const boundsCte = stepMin === undefined || stepMax === undefined
    ? `bounds AS (
        SELECT
          rids.runId AS runId,
          ifNull(sb.rawMinStep, toUInt64(0)) AS minStep,
          coalesce(nullIf(sb.rawMaxStep, 0), toUInt64(1000)) AS maxStep
        FROM (SELECT arrayJoin({runIds: Array(UInt64)}) AS runId) rids
        LEFT JOIN (
          SELECT runId,
            min(min_step) AS rawMinStep,
            max(max_step) AS rawMaxStep
          FROM mlop_metric_summaries_v2
          WHERE tenantId = {tenantId: String}
            AND projectName = {projectName: String}
            AND runId IN ({runIds: Array(UInt64)})
            AND logName = {logName: String}
          GROUP BY runId
        ) sb ON rids.runId = sb.runId
      )`
    : `bounds AS (
        SELECT runId, min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics_v2
        WHERE ${whereClause}${boundsStepRange}
        GROUP BY runId
      )`;

  const query = `
    WITH
      ${boundsCte},
      params AS (
        SELECT runId, minStep,
          greatest(toUInt64(1), intDiv(maxStep - minStep + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
        FROM bounds
      )
    SELECT
      m.runId AS runId,
      intDiv(m.step - p.minStep, p.bucketWidth) AS bucket,
      any(toUInt64(p.minStep + intDiv(m.step - p.minStep, p.bucketWidth) * p.bucketWidth)) AS step,
      argMin(m.time, m.step) AS time,
      avgIf(m.value, isFinite(m.value)) AS value,
      minIf(m.value, isFinite(m.value)) AS minY,
      maxIf(m.value, isFinite(m.value)) AS maxY,
      toUInt64(count()) AS count,
      toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
    FROM mlop_metrics_v2 m FINAL
    INNER JOIN params p ON m.runId = p.runId
    WHERE ${whereClause}${mainStepRange}
    GROUP BY m.runId, bucket
    ORDER BY m.runId, bucket ASC
  `;

  const result = await ch.query(query, queryParams);
  const rows = sanitizeBucketedRows(
    (await result.json()) as (BucketedMetricDataPoint & { runId: number })[]
  );

  // Group flat result set by runId
  const grouped: Record<number, BucketedMetricDataPoint[]> = {};
  for (const row of rows) {
    const arr = grouped[row.runId] ?? (grouped[row.runId] = []);
    arr.push({ step: row.step, time: row.time, value: row.value, minY: row.minY, maxY: row.maxY, count: row.count, nonFiniteFlags: row.nonFiniteFlags });
  }

  return grouped;
}

/**
 * Multi-metric batch bucketed query: fetches bucketed data for MULTIPLE metrics
 * across multiple runs in a SINGLE ClickHouse query.
 *
 * Uses per-metric bucket boundaries so each metric's step range is independently
 * bucketed. Returns a nested map: logName → runId → bucketed data points.
 */
export async function queryRunMetricsMultiMetricBatchBucketed(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
    logNames: string[];
    buckets?: number;
    stepMin?: number;
    stepMax?: number;
    preview?: boolean;
    algorithm?: DownsamplingAlgorithm;
  }
): Promise<Record<string, Record<number, BucketedMetricDataPoint[]>>> {
  const { organizationId, projectName, runIds, logNames, stepMin, stepMax, preview, algorithm } = params;

  if (runIds.length === 0 || logNames.length === 0) return {};

  if (algorithm === "lttb") {
    return queryRunMetricsMultiMetricBatchBucketedLttb(ch, params);
  }

  const numBuckets = params.buckets ?? (preview ? PREVIEW_BUCKETS : DEFAULT_BUCKETS);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    logNames,
    numBuckets,
  };

  let whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId IN ({runIds: Array(UInt64)})
    AND logName IN ({logNames: Array(String)})
  `;

  let mainStepRange = "";
  const hasStepRange = stepMin !== undefined && stepMax !== undefined;
  if (hasStepRange) {
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // When stepMin/stepMax are provided (zoom queries), skip the bounds CTE entirely —
  // compute bucketWidth directly from the provided range, avoiding a full table scan.
  let query: string;
  if (hasStepRange) {
    query = `
      SELECT
        m.logName AS logName,
        m.runId AS runId,
        intDiv(m.step - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
        any(toUInt64({stepMin: UInt64} + intDiv(m.step - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) * greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32}))))) AS step,
        argMin(m.time, m.step) AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(count()) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM mlop_metrics_v2 m FINAL
      WHERE ${whereClause}${mainStepRange}
      GROUP BY m.logName, m.runId, bucket
      ORDER BY m.logName, m.runId, bucket ASC
    `;
  } else {
    // PER-(runId, logName) bounds. Was: per-logName aggregated across all
    // selected runs, which gave every run the same bucket width and
    // collapsed short runs to a single bucket whenever a longer run was
    // also selected. Computing min/max per (run, metric) gives each run
    // its own bucket grid keyed to its own data length, so short runs
    // draw as real lines instead of lone bucket-center dots.
    //
    // Cross-join (arrayJoin runIds) × (arrayJoin logNames) materialises
    // every requested (run, metric) pair so RUNNING runs without a
    // summary row yet still produce a usable [0, 1000] fallback. Mirrors
    // the existing ifNull/coalesce fallback chain on the legacy
    // per-logName path.
    query = `
      WITH
        bounds AS (
          SELECT
            rids.runId AS runId,
            lns.ln AS logName,
            ifNull(sb.rawMinStep, toUInt64(0)) AS minStep,
            coalesce(nullIf(sb.rawMaxStep, 0), toUInt64(1000)) AS maxStep
          FROM (SELECT arrayJoin({runIds: Array(UInt64)}) AS runId) rids
          CROSS JOIN (SELECT arrayJoin({logNames: Array(String)}) AS ln) lns
          LEFT JOIN (
            SELECT runId, logName,
              min(min_step) AS rawMinStep,
              max(max_step) AS rawMaxStep
            FROM mlop_metric_summaries_v2
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId IN ({runIds: Array(UInt64)})
              AND logName IN ({logNames: Array(String)})
            GROUP BY runId, logName
          ) sb ON rids.runId = sb.runId AND lns.ln = sb.logName
        ),
        params AS (
          SELECT runId, logName, minStep,
            greatest(toUInt64(1), intDiv(maxStep - minStep + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
          FROM bounds
        )
      SELECT
        m.logName AS logName,
        m.runId AS runId,
        intDiv(m.step - p.minStep, p.bucketWidth) AS bucket,
        any(toUInt64(p.minStep + intDiv(m.step - p.minStep, p.bucketWidth) * p.bucketWidth)) AS step,
        argMin(m.time, m.step) AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(count()) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM mlop_metrics_v2 m FINAL
      INNER JOIN params p ON m.runId = p.runId AND m.logName = p.logName
      WHERE ${whereClause}
      GROUP BY m.logName, m.runId, bucket
      ORDER BY m.logName, m.runId, bucket ASC
    `;
  }

  const result = await ch.query(query, queryParams);
  const rows = sanitizeBucketedRows(
    (await result.json()) as (BucketedMetricDataPoint & { logName: string; runId: number })[]
  );

  // Group by logName → runId
  const grouped: Record<string, Record<number, BucketedMetricDataPoint[]>> = {};
  for (const row of rows) {
    const byRun = grouped[row.logName] ?? (grouped[row.logName] = {});
    const arr = byRun[row.runId] ?? (byRun[row.runId] = []);
    arr.push({ step: row.step, time: row.time, value: row.value, minY: row.minY, maxY: row.maxY, count: row.count, nonFiniteFlags: row.nonFiniteFlags });
  }

  return grouped;
}

/** Columnar representation of bucketed series — eliminates repeated key names in JSON */
export interface ColumnarBucketedSeries {
  steps: number[];
  times: string[];
  values: (number | null)[];
  minYs: (number | null)[];
  maxYs: (number | null)[];
  counts: number[];
  nfFlags: number[];
}

/** Convert row-oriented bucketed points to columnar format for wire transfer */
export function toColumnar(points: BucketedMetricDataPoint[]): ColumnarBucketedSeries {
  const len = points.length;
  const steps = new Array<number>(len);
  const times = new Array<string>(len);
  const values = new Array<number | null>(len);
  const minYs = new Array<number | null>(len);
  const maxYs = new Array<number | null>(len);
  const counts = new Array<number>(len);
  const nfFlags = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    const p = points[i];
    steps[i] = p.step;
    times[i] = p.time;
    values[i] = p.value;
    minYs[i] = p.minY;
    maxYs[i] = p.maxY;
    counts[i] = p.count;
    nfFlags[i] = p.nonFiniteFlags;
  }
  return { steps, times, values, minYs, maxYs, counts, nfFlags };
}

/**
 * How far a y point may reach back for an x reading, as a multiple of the
 * x-metric's own average step spacing.
 *
 * Exact-step matching alone is too strict for a very ordinary pattern: a
 * throughput counter logged on a wall-clock timer lands on irregular steps
 * (0, 7, 14, 21 …) while eval runs on a step schedule (250, 500, 750 …). Both
 * metrics span the same range and the curve is obviously plottable, yet the two
 * almost never share an exact step — 30 of 200 points on a seeded run, and zero
 * with slightly different jitter.
 *
 * 10 gaps is loose enough that ordinary jitter always matches and tight enough
 * that a metric which STOPPED logging cannot pin every later point to one stale
 * reading — which would draw a flat line and present it as data. W&B applies no
 * such bound; it always carries the current value forward.
 */
const ASOF_GAP_FACTOR = 10;

/** One bucket of a parametric (y-vs-x) curve: a bucketed y point plus the
 *  x-metric value that supplies its horizontal coordinate. */
export interface ParametricBucketedPoint extends BucketedMetricDataPoint {
  /** avg of the x-metric over the bucket — the horizontal coordinate */
  x: number;
}

/** Columnar parametric series — {@link ColumnarBucketedSeries} plus the x column. */
export interface ColumnarParametricSeries extends ColumnarBucketedSeries {
  xs: number[];
}

/** Convert row-oriented parametric points to columnar format for wire transfer */
export function toColumnarParametric(
  points: ParametricBucketedPoint[]
): ColumnarParametricSeries {
  const base = toColumnar(points);
  const xs = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) {
    xs[i] = points[i].x;
  }
  return { ...base, xs };
}

/**
 * Parametric (y-vs-x) bucketed query: plots y-metrics against another metric
 * on the x-axis, joined on step, for multiple runs in a SINGLE query.
 *
 * Pairing is AS-OF, not exact: each y point takes the most recent x reading at
 * or before its own step, within ASOF_GAP_FACTOR typical gaps. That is the same
 * semantic W&B gives `define_metric(step_metric=…)` — verified against their API
 * on identical data, where every point they attach matches the preceding x
 * reading rather than the nearest or an interpolation. The difference is when it
 * is applied: W&B binds the value at LOG time, so a run recorded without the
 * declaration can never be re-plotted this way. Doing it at query time means it
 * works on data already collected, with nothing to declare in advance.
 *
 * Reaching backwards (rather than to the nearest reading either side) also never
 * overstates a cumulative counter: "loss at 2.0B timesteps" reports the tokens
 * actually consumed by then, never a later, larger figure.
 *
 * The join runs on RAW rows and bucketing happens AFTER, on the joined pairs.
 * That ordering is the entire point of this procedure. Fetching x and y
 * through two independently-downsampled endpoints and joining in the browser
 * destroys the alignment: bucketing rewrites y's steps to synthetic bucket
 * boundaries (`minStep + bucket * bucketWidth` — step values that were never
 * logged), while reservoir sampling keeps only every k-th real step of x. An
 * exact-equality join between those two sets finds `range / lcm(k, width)`
 * points — frequently zero — even when every raw y point has an exact x
 * partner. Joining first and downsampling second keeps x and y together by
 * construction, the way a single wide history row would.
 *
 * Buckets are cut along STEP, and the result is returned in step order. Step is
 * the curve's parameter: it is what orders the points along the path, and it is
 * the only ordering that survives an x-metric which doubles back.
 *
 * An earlier version bucketed along X instead, to guarantee the x-sorted output
 * uPlot needs. That works, but it silently averages the branches of any
 * non-monotonic x together: on a warmup-then-decay learning rate, the same LR
 * occurs once on the way up and once on the way down, and collapsing them
 * reports a loss that happened at neither. Keeping step order preserves both
 * branches; the client splits them into separate monotonic series before
 * handing them to uPlot (see splitMonotonicLegs).
 *
 * xMin/xMax filter on the JOINED x value, which is what a zoom on a parametric
 * chart selects — the viewport is a range of the x-metric, not of step. Buckets
 * are then computed over the filtered rows, so zooming buys real resolution.
 *
 * Returns a nested map: logName → runId → parametric points in step order. A
 * (logName, runId) pair with no overlapping steps is absent from the result.
 */
export async function queryRunMetricsParametricBatchBucketed(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
    logNames: string[];
    /** logName supplying the x coordinate */
    xMetric: string;
    buckets?: number;
    stepMin?: number;
    stepMax?: number;
    /** Zoom window on the x-METRIC's value (not on step) */
    xMin?: number;
    xMax?: number;
    preview?: boolean;
  }
): Promise<Record<string, Record<number, ParametricBucketedPoint[]>>> {
  const { organizationId, projectName, runIds, logNames, xMetric, stepMin, stepMax, xMin, xMax, preview } = params;

  if (runIds.length === 0 || logNames.length === 0 || !xMetric) return {};

  const numBuckets = params.buckets ?? (preview ? PREVIEW_BUCKETS : DEFAULT_BUCKETS);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    logNames,
    xMetric,
    numBuckets,
    asofGapFactor: ASOF_GAP_FACTOR,
  };

  let stepRange = "";
  if (stepMin !== undefined && stepMax !== undefined) {
    stepRange = ` AND step >= {stepMin: UInt64} AND step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // A zoom on a parametric chart selects a range of the x-METRIC. Applying it to
  // the joined rows (rather than to either input series) is what makes zoom buy
  // real resolution: bucket bounds below are computed over the survivors.
  let xWindow = "";
  if (xMin !== undefined && xMax !== undefined) {
    xWindow = ` WHERE xv >= {xMin: Float64} AND xv <= {xMax: Float64}`;
    queryParams.xMin = xMin;
    queryParams.xMax = xMax;
  }

  const scopeFilter = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId IN ({runIds: Array(UInt64)})
  `;

  // xs collapses to one value per (runId, step) so the join can't fan out.
  // Non-finite x values are dropped: they cannot position a point on the axis.
  // ys keeps raw rows so the per-bucket aggregation matches the non-parametric
  // bucketed path exactly (avgIf/minIf/maxIf over every row in the bucket).
  const query = `
    WITH
      xs AS (
        SELECT runId, step, argMax(value, time) AS xv
        FROM mlop_metrics_v2 FINAL
        WHERE ${scopeFilter}
          AND logName = {xMetric: String}
          AND isFinite(value)${stepRange}
        GROUP BY runId, step
      ),
      ys AS (
        SELECT logName, runId, step, time, value
        FROM mlop_metrics_v2 FINAL
        WHERE ${scopeFilter}
          AND logName IN ({logNames: Array(String)})${stepRange}
      ),
      -- How far a y point may reach back for an x reading, per run. Expressed
      -- in the x-metric's OWN typical spacing rather than an absolute number of
      -- steps, because cadences differ by orders of magnitude between runs: one
      -- logs every step, the next every thousand.
      xgap AS (
        SELECT runId,
          greatest(
            intDiv(max(step) - min(step), greatest(count() - 1, 1)) * {asofGapFactor: UInt32},
            toUInt64(1)
          ) AS maxGap
        FROM xs GROUP BY runId
      ),
      paired AS (
        SELECT ys.logName AS logName, ys.runId AS runId, ys.step AS step,
               ys.time AS time, ys.value AS value, xs.xv AS xv,
               ys.step - xs.step AS gap
        FROM ys ASOF JOIN xs ON ys.runId = xs.runId AND ys.step >= xs.step
      ),
      j AS (
        SELECT * FROM (
          SELECT p.logName AS logName, p.runId AS runId, p.step AS step,
                 p.time AS time, p.value AS value, p.xv AS xv
          FROM paired p
          INNER JOIN xgap g ON p.runId = g.runId
          WHERE p.gap <= g.maxGap
        )${xWindow}
      ),
      params AS (
        SELECT logName, runId, min(step) AS minStep,
          greatest(toUInt64(1), intDiv(max(step) - min(step) + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
        FROM j
        GROUP BY logName, runId
      )
    SELECT
      j.logName AS logName,
      j.runId AS runId,
      intDiv(j.step - p.minStep, p.bucketWidth) AS bucket,
      any(toUInt64(p.minStep + intDiv(j.step - p.minStep, p.bucketWidth) * p.bucketWidth)) AS step,
      argMin(j.time, j.step) AS time,
      avg(j.xv) AS x,
      avgIf(j.value, isFinite(j.value)) AS value,
      minIf(j.value, isFinite(j.value)) AS minY,
      maxIf(j.value, isFinite(j.value)) AS maxY,
      toUInt64(count()) AS count,
      toUInt8((countIf(isNaN(j.value)) > 0) + (countIf(isInfinite(j.value) AND j.value > 0) > 0) * 2 + (countIf(isInfinite(j.value) AND j.value < 0) > 0) * 4) AS nonFiniteFlags
    FROM j
    INNER JOIN params p ON j.runId = p.runId AND j.logName = p.logName
    GROUP BY j.logName, j.runId, bucket
    ORDER BY j.logName, j.runId, bucket ASC
  `;
  // bucket ASC == step ASC: points come back in curve order, which the client
  // needs in order to detect where a non-monotonic x turns around.

  const result = await ch.query(query, queryParams);
  const raw = (await result.json()) as (ParametricBucketedPoint & {
    logName: string;
    runId: number;
  })[];
  const rows = sanitizeBucketedRows(raw) as typeof raw;

  // Group by logName → runId
  const grouped: Record<string, Record<number, ParametricBucketedPoint[]>> = {};
  for (const row of rows) {
    const byRun = grouped[row.logName] ?? (grouped[row.logName] = {});
    const arr = byRun[row.runId] ?? (byRun[row.runId] = []);
    arr.push({
      step: row.step,
      time: row.time,
      x: Number(row.x),
      value: row.value,
      minY: row.minY,
      maxY: row.maxY,
      count: row.count,
      nonFiniteFlags: row.nonFiniteFlags,
    });
  }

  return grouped;
}

/**
 * Which of `runIds` have any data at all for `xMetric`.
 *
 * Lets the caller tell "the x-metric was never logged for this run" apart from
 * "both metrics exist but share no steps" — two very different user-facing
 * problems that today collapse into one identical "Could not compare" message.
 */
export async function queryRunsWithMetric(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
    logName: string;
  }
): Promise<number[]> {
  const { organizationId, projectName, runIds, logName } = params;
  if (runIds.length === 0 || !logName) return [];

  // mlop_metrics_v2, not mlop_metric_summaries_v2. The summaries table is a
  // REFRESHABLE materialized view on a 5-minute cycle, so for up to five
  // minutes after a metric is first written it holds no row for it — and this
  // function would report a metric the run demonstrably logged as one it never
  // logged, sending the chart to the wrong empty state. mlop_metrics_v2 is fed
  // by an insert-triggered MV and is current the moment the write lands.
  //
  // `LIMIT 1 BY runId` keeps this as cheap as the summaries lookup was: the
  // ORDER BY prefix (tenantId, projectName, runId, logGroup, logName) means
  // one index seek per run, and it stops at the first matching row instead of
  // scanning the run's whole history.
  const result = await ch.query(
    `SELECT runId
     FROM mlop_metrics_v2
     WHERE tenantId = {tenantId: String}
       AND projectName = {projectName: String}
       AND runId IN ({runIds: Array(UInt64)})
       AND logName = {logName: String}
     LIMIT 1 BY runId`,
    { tenantId: organizationId, projectName, runIds, logName }
  );
  const rows = (await result.json()) as { runId: number | string }[];
  return rows.map((r) => Number(r.runId));
}

/** Aggregated bucketed series for one group of runs at one logName.
 *  Mean = value (the line); min/max = envelope across runs in the group
 *  inside each bucket. */
export async function queryRunMetricsGroupedBatchBucketed(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    /** Maps each numeric runId to the bucket trail it belongs to
     *  (the JSON-stringified GroupFilter[] key). One CH query covers
     *  ALL groups at once via an inline (runId, groupKey) join. */
    runGroupKeyMap: Map<number, string>;
    logNames: string[];
    buckets?: number;
    stepMin?: number;
    stepMax?: number;
    preview?: boolean;
    /** "step" (default), "time" (absolute wall-clock), or
     *  "relative-time" (per-run baselined). All three modes now use
     *  per-(groupKey, logName) bucket bounds, so a short-duration
     *  group rendered alongside a long-duration group keeps its full
     *  resolution. Custom-metric-x is still deferred — see
     *  grouped-line-chart.tsx TODO. */
    xAxis?: "step" | "time" | "relative-time";
  }
): Promise<Record<string, Record<string, BucketedMetricDataPoint[]>>> {
  const { organizationId, projectName, runGroupKeyMap, logNames, stepMin, stepMax, preview, xAxis = "step" } = params;

  if (runGroupKeyMap.size === 0 || logNames.length === 0) return {};

  // Flatten the group-membership map into the parallel arrays
  // ClickHouse parameter binding expects. The two arrays are correlated
  // by index — the SQL stitches them back together with `arrayJoin` +
  // `tupleElement`.
  const runIds: number[] = [];
  const groupKeys: string[] = [];
  for (const [runId, groupKey] of runGroupKeyMap) {
    runIds.push(runId);
    groupKeys.push(groupKey);
  }
  const numBuckets = params.buckets ?? (preview ? PREVIEW_BUCKETS : DEFAULT_BUCKETS);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    groupKeys,
    logNames,
    numBuckets,
  };

  let whereClause = `
    m.tenantId = {tenantId: String}
    AND m.projectName = {projectName: String}
    AND m.runId IN ({runIds: Array(UInt64)})
    AND m.logName IN ({logNames: Array(String)})
  `;

  let mainStepRange = "";
  const hasStepRange = stepMin !== undefined && stepMax !== undefined;
  if (hasStepRange) {
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // `groups` CTE turns the parallel runIds[]/groupKeys[] arrays into a
  // (runId, groupKey) join table the main aggregation can join on.
  // `arrayMap + tuple + arrayJoin` is the canonical ClickHouse idiom
  // for "make a virtual table from two correlated arrays".
  const groupsCte = `
    groups AS (
      SELECT
        tupleElement(t, 1) AS runId,
        tupleElement(t, 2) AS groupKey
      FROM (
        SELECT arrayJoin(arrayMap(
          (rid, gk) -> tuple(rid, gk),
          {runIds: Array(UInt64)},
          {groupKeys: Array(String)}
        )) AS t
      )
    )
  `;

  let query: string;
  if (xAxis === "relative-time") {
    // Relative-time mode: bucket by per-run elapsed time. Each run's
    // own first-log timestamp is its baseline; we subtract that from
    // every sample BEFORE bucketing so runs that started at different
    // wall-clocks line up on a common 0-axis. The bucket-start
    // relative-ms is encoded in the `step` field (UInt64) so the
    // frontend can read it without DateTime64 epoch arithmetic.
    //
    // PER-(groupKey, logName) bounds AND per-run baselines come from
    // mlop_metric_summaries_v2 — same trick the step-axis branch uses,
    // tiny one-row-per-(run, metric) read instead of a raw scan. Was:
    // two raw scans (baselines + bounds) on top of the main scan;
    // now: zero raw scans for bounds, just the main aggregation.
    query = `
      WITH
        ${groupsCte},
        run_baselines AS (
          SELECT runId, toUInt64(toUnixTimestamp64Milli(min(min_time))) AS baselineMs
          FROM mlop_metric_summaries_v2 FINAL
          WHERE tenantId = {tenantId: String}
            AND projectName = {projectName: String}
            AND runId IN ({runIds: Array(UInt64)})
            AND logName IN ({logNames: Array(String)})
          GROUP BY runId
        ),
        bounds AS (
          SELECT
            g.groupKey AS groupKey,
            s.logName AS logName,
            toUInt64(0) AS minMs,
            max(toUInt64(toUnixTimestamp64Milli(s.max_time)) - rb.baselineMs) AS maxMs
          FROM mlop_metric_summaries_v2 s FINAL
          INNER JOIN groups g ON s.runId = g.runId
          INNER JOIN run_baselines rb ON s.runId = rb.runId
          WHERE s.tenantId = {tenantId: String}
            AND s.projectName = {projectName: String}
            AND s.runId IN ({runIds: Array(UInt64)})
            AND s.logName IN ({logNames: Array(String)})
          GROUP BY g.groupKey, s.logName
        ),
        params AS (
          SELECT groupKey, logName, minMs,
            greatest(toUInt64(1), intDiv(maxMs - minMs + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
          FROM bounds
        )
      SELECT
        m.logName AS logName,
        g.groupKey AS groupKey,
        intDiv(toUInt64(toUnixTimestamp64Milli(m.time)) - rb.baselineMs, p.bucketWidth) AS bucket,
        -- Bucket-start relative-ms encoded in step. Frontend reads
        -- this as the x-axis value and divides by 1000 for seconds.
        any(toUInt64(p.minMs + intDiv(toUInt64(toUnixTimestamp64Milli(m.time)) - rb.baselineMs, p.bucketWidth) * p.bucketWidth)) AS step,
        argMin(m.time, m.time) AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(uniqExact(m.runId)) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM mlop_metrics_v2 m FINAL
      INNER JOIN groups g ON m.runId = g.runId
      INNER JOIN run_baselines rb ON m.runId = rb.runId
      INNER JOIN params p ON g.groupKey = p.groupKey AND m.logName = p.logName
      WHERE ${whereClause}
      GROUP BY m.logName, g.groupKey, bucket
      ORDER BY m.logName, g.groupKey, bucket ASC
    `;
  } else if (xAxis === "time") {
    // Time-x mode: bucket by absolute wall-clock time (DateTime64
    // millis). Bounds come from mlop_metric_summaries_v2's
    // min_time / max_time columns — tiny one-row-per-(run, metric)
    // read instead of a raw scan. stepMin/stepMax are ignored in time
    // mode — drag-zoom on a time axis would need timeMin/timeMax,
    // which is a separate follow-up.
    //
    // PER-(groupKey, logName) bounds — same shape as the step-axis
    // branch below. Shared bounds would let one group's wall-clock
    // span dictate the bucketWidth for everyone, collapsing
    // short-duration groups to a single bucket.
    query = `
      WITH
        ${groupsCte},
        bounds AS (
          SELECT
            g.groupKey AS groupKey,
            s.logName AS logName,
            toUInt64(toUnixTimestamp64Milli(min(s.min_time))) AS minMs,
            toUInt64(toUnixTimestamp64Milli(max(s.max_time))) AS maxMs
          FROM mlop_metric_summaries_v2 s FINAL
          INNER JOIN groups g ON s.runId = g.runId
          WHERE s.tenantId = {tenantId: String}
            AND s.projectName = {projectName: String}
            AND s.runId IN ({runIds: Array(UInt64)})
            AND s.logName IN ({logNames: Array(String)})
          GROUP BY g.groupKey, s.logName
        ),
        params AS (
          SELECT groupKey, logName, minMs,
            greatest(toUInt64(1), intDiv(maxMs - minMs + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
          FROM bounds
        )
      SELECT
        m.logName AS logName,
        g.groupKey AS groupKey,
        intDiv(toUInt64(toUnixTimestamp64Milli(m.time)) - p.minMs, p.bucketWidth) AS bucket,
        argMin(m.step, m.time) AS step,
        toDateTime64(toFloat64(any(p.minMs + intDiv(toUInt64(toUnixTimestamp64Milli(m.time)) - p.minMs, p.bucketWidth) * p.bucketWidth)) / 1000, 3) AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(uniqExact(m.runId)) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM mlop_metrics_v2 m FINAL
      INNER JOIN groups g ON m.runId = g.runId
      INNER JOIN params p ON g.groupKey = p.groupKey AND m.logName = p.logName
      WHERE ${whereClause}
      GROUP BY m.logName, g.groupKey, bucket
      ORDER BY m.logName, g.groupKey, bucket ASC
    `;
  } else if (hasStepRange) {
    // Zoom/preview: explicit step range, no bounds CTE needed —
    // bucketWidth derives directly from (stepMax - stepMin).
    query = `
      WITH ${groupsCte}
      SELECT
        m.logName AS logName,
        g.groupKey AS groupKey,
        intDiv(m.step - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
        any(toUInt64({stepMin: UInt64} + intDiv(m.step - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) * greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32}))))) AS step,
        argMin(m.time, m.step) AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(uniqExact(m.runId)) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM mlop_metrics_v2 m FINAL
      INNER JOIN groups g ON m.runId = g.runId
      WHERE ${whereClause}${mainStepRange}
      GROUP BY m.logName, g.groupKey, bucket
      ORDER BY m.logName, g.groupKey, bucket ASC
    `;
  } else {
    // PER-(groupKey, logName) bounds. Was: per-logName aggregated across
    // every selected run, which collapsed short groups to a single
    // bucket whenever a longer group was in the chart. Same fix as the
    // flat (non-grouped) batch path — each group now gets its own
    // bucket width derived from ITS OWN runs' min/max step.
    query = `
      WITH
        ${groupsCte},
        bounds AS (
          SELECT
            g.groupKey AS groupKey,
            lns.ln AS logName,
            ifNull(min(sb.minStep), toUInt64(0)) AS minStep,
            coalesce(nullIf(max(sb.maxStep), 0), toUInt64(1000)) AS maxStep
          FROM groups g
          CROSS JOIN (SELECT arrayJoin({logNames: Array(String)}) AS ln) lns
          LEFT JOIN (
            SELECT runId, logName,
              min(min_step) AS minStep,
              max(max_step) AS maxStep
            FROM mlop_metric_summaries_v2
            WHERE tenantId = {tenantId: String}
              AND projectName = {projectName: String}
              AND runId IN ({runIds: Array(UInt64)})
              AND logName IN ({logNames: Array(String)})
            GROUP BY runId, logName
          ) sb ON g.runId = sb.runId AND lns.ln = sb.logName
          GROUP BY g.groupKey, lns.ln
        ),
        params AS (
          SELECT groupKey, logName, minStep,
            greatest(toUInt64(1), intDiv(maxStep - minStep + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
          FROM bounds
        )
      SELECT
        m.logName AS logName,
        g.groupKey AS groupKey,
        intDiv(m.step - p.minStep, p.bucketWidth) AS bucket,
        any(toUInt64(p.minStep + intDiv(m.step - p.minStep, p.bucketWidth) * p.bucketWidth)) AS step,
        argMin(m.time, m.step) AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(uniqExact(m.runId)) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM mlop_metrics_v2 m FINAL
      INNER JOIN groups g ON m.runId = g.runId
      INNER JOIN params p ON g.groupKey = p.groupKey AND m.logName = p.logName
      WHERE ${whereClause}
      GROUP BY m.logName, g.groupKey, bucket
      ORDER BY m.logName, g.groupKey, bucket ASC
    `;
  }

  const result = await ch.query(query, queryParams);
  const rows = sanitizeBucketedRows(
    (await result.json()) as (BucketedMetricDataPoint & { logName: string; groupKey: string })[]
  );

  // Group by logName → groupKey. Output shape matches the flat path
  // (`Record<logName, Record<key, points[]>>`) with `key` swapped from
  // encoded runId to bucket pathKey.
  const out: Record<string, Record<string, BucketedMetricDataPoint[]>> = {};
  for (const row of rows) {
    const byGroup = out[row.logName] ?? (out[row.logName] = {});
    const arr = byGroup[row.groupKey] ?? (byGroup[row.groupKey] = []);
    arr.push({
      step: row.step,
      time: row.time,
      value: row.value,
      minY: row.minY,
      maxY: row.maxY,
      count: row.count,
      nonFiniteFlags: row.nonFiniteFlags,
    });
  }
  return out;
}

export async function queryRunMetricsBatchByLogName(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
    logName: string;
    stepMin?: number;
    stepMax?: number;
    maxPoints?: number; // per-run limit: 0 = no limit, undefined = DEFAULT_MAX_POINTS
    preview?: boolean;
  }
): Promise<Record<number, MetricDataPoint[]>> {
  const { organizationId, projectName, runIds, logName, stepMin, stepMax, maxPoints, preview } = params;

  if (runIds.length === 0) return {};

  const logGroup = getLogGroupName(logName);
  const effectiveLimit = maxPoints === undefined ? DEFAULT_MAX_POINTS : maxPoints;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    logName,
    logGroup,
  };

  let query: string;

  if (stepMin !== undefined && stepMax !== undefined) {
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;

    if (effectiveLimit === 0) {
      // No sampling — return all rows in range
      query = `
        SELECT runId, value, ${VALUE_FLAG_SELECT}, time, step
        FROM mlop_metrics_v2 FINAL
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId IN ({runIds: Array(UInt64)})
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
          AND step >= {stepMin: UInt64}
          AND step <= {stepMax: UInt64}
        ORDER BY runId, step ASC
      `;
    } else if (preview && effectiveLimit > 0) {
      // Fast preview: stride-based sampling, no window functions.
      // Selects every Nth step across the full zoom range so data covers the
      // entire visible area at once rather than filling in left-to-right.
      query = `
        SELECT runId, value, ${VALUE_FLAG_SELECT}, time, step
        FROM mlop_metrics_v2 FINAL
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId IN ({runIds: Array(UInt64)})
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
          AND step >= {stepMin: UInt64}
          AND step <= {stepMax: UInt64}
          AND (step - {stepMin: UInt64}) % greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64}, toUInt64(${effectiveLimit}))) = 0
        ORDER BY runId, step ASC
      `;
    } else {
      // Reservoir sampling per run within step range
      query = `
        WITH counted AS (
          SELECT runId, value, time, step,
            count() OVER (PARTITION BY runId) as total_rows,
            row_number() OVER (PARTITION BY runId ORDER BY step ASC) as rn
          FROM mlop_metrics_v2 FINAL
          WHERE tenantId = {tenantId: String}
            AND projectName = {projectName: String}
            AND runId IN ({runIds: Array(UInt64)})
            AND logName = {logName: String}
            AND logGroup = {logGroup: String}
            AND step >= {stepMin: UInt64}
            AND step <= {stepMax: UInt64}
        )
        SELECT runId, value, ${VALUE_FLAG_SELECT}, time, step FROM counted
        WHERE total_rows <= ${effectiveLimit}
           OR rn % ceiling(total_rows / ${effectiveLimit}) = 1
           OR rn = total_rows
        ORDER BY runId, step ASC
      `;
    }
  } else if (effectiveLimit === 0) {
    // No sampling — return all data
    query = `
      SELECT runId, value, ${VALUE_FLAG_SELECT}, time, step
      FROM mlop_metrics_v2 FINAL
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND runId IN ({runIds: Array(UInt64)})
        AND logName = {logName: String}
        AND logGroup = {logGroup: String}
      ORDER BY runId, step ASC
    `;
  } else if (preview && effectiveLimit > 0) {
    // Fast preview: LIMIT per run using row_number
    query = `
      WITH numbered AS (
        SELECT runId, value, time, step,
          row_number() OVER (PARTITION BY runId ORDER BY step ASC) as rn
        FROM mlop_metrics_v2 FINAL
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId IN ({runIds: Array(UInt64)})
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
      )
      SELECT runId, value, ${VALUE_FLAG_SELECT}, time, step FROM numbered
      WHERE rn <= ${effectiveLimit}
      ORDER BY runId, step ASC
    `;
  } else {
    // Reservoir sampling per run
    query = `
      WITH counted AS (
        SELECT runId, value, time, step,
          count() OVER (PARTITION BY runId) as total_rows,
          row_number() OVER (PARTITION BY runId ORDER BY step ASC) as rn
        FROM mlop_metrics_v2 FINAL
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId IN ({runIds: Array(UInt64)})
          AND logName = {logName: String}
          AND logGroup = {logGroup: String}
      )
      SELECT runId, value, ${VALUE_FLAG_SELECT}, time, step FROM counted
      WHERE total_rows <= ${effectiveLimit}
         OR rn % ceiling(total_rows / ${effectiveLimit}) = 1
         OR rn = total_rows
      ORDER BY runId, step ASC
    `;
  }

  const result = await ch.query(query, queryParams);
  const rows = sanitizeMetricRows((await result.json()) as (MetricDataPoint & { runId: number })[]);

  // Group flat result set by runId
  const grouped: Record<number, MetricDataPoint[]> = {};
  for (const row of rows) {
    const arr = grouped[row.runId] ?? (grouped[row.runId] = []);
    arr.push({ value: row.value, valueFlag: row.valueFlag, time: row.time, step: row.step });
  }

  return grouped;
}

// ---------------------------------------------------------------------------
// LTTB variants — use ClickHouse's native lttb() aggregate function for
// downsampling, combined with bucket aggregation for min/max envelopes.
//
// Single query per variant: bucket aggregation (min/max/count/flags) runs
// alongside lttb(N)(step, value) grouped by (logName, runId). The LTTB-
// selected value replaces avg() as each bucket's representative value,
// preserving visual shape while keeping envelope bands.
// ---------------------------------------------------------------------------

/** Non-finite flags bitmask SQL fragment */
const NF_FLAGS_SQL = `toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4)`;

/**
 * LTTB variant of queryRunMetricsBucketedByLogName (single run, single metric).
 *
 * Runs two passes in a single query:
 *   1. Bucket aggregation → min/max/count/nonFiniteFlags per bucket (envelopes)
 *   2. lttb(N)(step, value) → visually representative points
 * Then JOINs the LTTB value onto each bucket, falling back to avg if no
 * LTTB point lands in a given bucket.
 */
async function queryRunMetricsBucketedByLogNameLttb(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    logName: string;
    buckets?: number;
    stepMin?: number;
    stepMax?: number;
    preview?: boolean;
  },
): Promise<BucketedMetricDataPoint[]> {
  const { organizationId, projectName, runId, logName, stepMin, stepMax, preview } = params;
  const logGroup = getLogGroupName(logName);
  const numBuckets = params.buckets ?? (preview ? PREVIEW_BUCKETS : DEFAULT_BUCKETS);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runId,
    logName,
    logGroup,
    numBuckets,
  };

  const whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId = {runId: UInt64}
    AND logName = {logName: String}
    AND logGroup = {logGroup: String}
  `;

  let boundsStepRange = "";
  let mainStepRange = "";
  if (stepMin !== undefined && stepMax !== undefined) {
    boundsStepRange = ` AND step >= {stepMin: UInt64} AND step <= {stepMax: UInt64}`;
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // Non-zoom: bounds from mlop_metric_summaries (≤5 min stale on the right
  // edge for RUNNING runs). Zoom: bucket width must reflect the zoomed range,
  // so scan raw v2 directly.
  const boundsCte = stepMin === undefined || stepMax === undefined
    ? `bounds AS (
        SELECT
          ifNull(min(min_step), toUInt64(0)) AS minStep,
          coalesce(nullIf(max(max_step), 0), toUInt64(1000)) AS maxStep
        FROM mlop_metric_summaries_v2
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
      )`
    : `bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics_v2
        WHERE ${whereClause}${boundsStepRange}
      )`;

  const query = `
    WITH
      ${boundsCte},
      params AS (
        SELECT minStep,
          greatest(toUInt64(1), intDiv(maxStep - minStep + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
        FROM bounds
      ),
      bucket_agg AS (
        SELECT
          intDiv(m.step - p.minStep, p.bucketWidth) AS bucket,
          min(m.step) AS step,
          argMin(m.time, m.step) AS time,
          avgIf(m.value, isFinite(m.value)) AS avg_value,
          minIf(m.value, isFinite(m.value)) AS minY,
          maxIf(m.value, isFinite(m.value)) AS maxY,
          toUInt64(count()) AS count,
          ${NF_FLAGS_SQL} AS nonFiniteFlags
        FROM mlop_metrics_v2 m FINAL
        CROSS JOIN params p
        WHERE ${whereClause}${mainStepRange}
        GROUP BY bucket
      ),
      lttb_selected AS (
        SELECT lttb({numBuckets: UInt32})(toFloat64(m.step), m.value) AS sampled_points
        FROM mlop_metrics_v2 m FINAL
        WHERE ${whereClause}${mainStepRange} AND isFinite(m.value)
      ),
      lttb_bucketed AS (
        SELECT
          intDiv(toUInt64(tupleElement(pt, 1)) - p.minStep, p.bucketWidth) AS bucket,
          tupleElement(pt, 2) AS lttb_value
        FROM lttb_selected
        CROSS JOIN params p
        ARRAY JOIN sampled_points AS pt
      ),
      lttb_per_bucket AS (
        SELECT bucket, toNullable(any(lttb_value)) AS lttb_value
        FROM lttb_bucketed
        GROUP BY bucket
      )
    SELECT
      ba.step AS step,
      ba.time AS time,
      if(lpb.lttb_value IS NOT NULL, lpb.lttb_value, ba.avg_value) AS value,
      ba.minY AS minY,
      ba.maxY AS maxY,
      ba.count AS count,
      ba.nonFiniteFlags AS nonFiniteFlags
    FROM bucket_agg ba
    LEFT JOIN lttb_per_bucket lpb ON ba.bucket = lpb.bucket
    ORDER BY ba.bucket ASC
  `;

  const result = await ch.query(query, queryParams);
  return sanitizeBucketedRows((await result.json()) as BucketedMetricDataPoint[]);
}

/**
 * LTTB variant of queryRunMetricsBatchBucketedByLogName (multi run, single metric).
 */
async function queryRunMetricsBatchBucketedByLogNameLttb(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
    logName: string;
    buckets?: number;
    stepMin?: number;
    stepMax?: number;
    preview?: boolean;
  },
): Promise<Record<number, BucketedMetricDataPoint[]>> {
  const { organizationId, projectName, runIds, logName, stepMin, stepMax, preview } = params;
  const logGroup = getLogGroupName(logName);
  const numBuckets = params.buckets ?? (preview ? PREVIEW_BUCKETS : DEFAULT_BUCKETS);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    logName,
    logGroup,
    numBuckets,
  };

  const whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId IN ({runIds: Array(UInt64)})
    AND logName = {logName: String}
    AND logGroup = {logGroup: String}
  `;

  let boundsStepRange = "";
  let mainStepRange = "";
  if (stepMin !== undefined && stepMax !== undefined) {
    boundsStepRange = ` AND step >= {stepMin: UInt64} AND step <= {stepMax: UInt64}`;
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // Non-zoom: bounds from mlop_metric_summaries.
  // Zoom: raw mlop_metrics_v2 (range comes from caller).
  const boundsCte = stepMin === undefined || stepMax === undefined
    ? `bounds AS (${buildSummaryBoundsBodySingleMetric(" AND logName = {logName: String}")})`
    : `bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics_v2
        WHERE ${whereClause}${boundsStepRange}
      )`;

  const query = `
    WITH
      ${boundsCte},
      params AS (
        SELECT minStep,
          greatest(toUInt64(1), intDiv(maxStep - minStep + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
        FROM bounds
      ),
      bucket_agg AS (
        SELECT
          m.runId AS runId,
          intDiv(m.step - p.minStep, p.bucketWidth) AS bucket,
          min(m.step) AS step,
          argMin(m.time, m.step) AS time,
          avgIf(m.value, isFinite(m.value)) AS avg_value,
          minIf(m.value, isFinite(m.value)) AS minY,
          maxIf(m.value, isFinite(m.value)) AS maxY,
          toUInt64(count()) AS count,
          ${NF_FLAGS_SQL} AS nonFiniteFlags
        FROM mlop_metrics_v2 m FINAL
        CROSS JOIN params p
        WHERE ${whereClause}${mainStepRange}
        GROUP BY m.runId, bucket
      ),
      lttb_selected AS (
        SELECT
          runId,
          lttb({numBuckets: UInt32})(toFloat64(step), value) AS sampled_points
        FROM mlop_metrics_v2 FINAL
        WHERE ${whereClause}${boundsStepRange} AND isFinite(value)
        GROUP BY runId
      ),
      lttb_bucketed AS (
        SELECT
          ls.runId AS runId,
          intDiv(toUInt64(tupleElement(pt, 1)) - p.minStep, p.bucketWidth) AS bucket,
          tupleElement(pt, 2) AS lttb_value
        FROM lttb_selected ls
        CROSS JOIN params p
        ARRAY JOIN sampled_points AS pt
      ),
      lttb_per_bucket AS (
        SELECT runId, bucket, toNullable(any(lttb_value)) AS lttb_value
        FROM lttb_bucketed
        GROUP BY runId, bucket
      )
    SELECT
      ba.runId AS runId,
      ba.step AS step,
      ba.time AS time,
      if(lpb.lttb_value IS NOT NULL, lpb.lttb_value, ba.avg_value) AS value,
      ba.minY AS minY,
      ba.maxY AS maxY,
      ba.count AS count,
      ba.nonFiniteFlags AS nonFiniteFlags
    FROM bucket_agg ba
    LEFT JOIN lttb_per_bucket lpb ON ba.runId = lpb.runId AND ba.bucket = lpb.bucket
    ORDER BY ba.runId, ba.bucket ASC
  `;

  const result = await ch.query(query, queryParams);
  const rows = sanitizeBucketedRows(
    (await result.json()) as (BucketedMetricDataPoint & { runId: number })[]
  );

  // Group by runId
  const grouped: Record<number, BucketedMetricDataPoint[]> = {};
  for (const row of rows) {
    const arr = grouped[row.runId] ?? (grouped[row.runId] = []);
    arr.push({ step: row.step, time: row.time, value: row.value, minY: row.minY, maxY: row.maxY, count: row.count, nonFiniteFlags: row.nonFiniteFlags });
  }

  return grouped;
}

/**
 * LTTB variant of queryRunMetricsMultiMetricBatchBucketed (multi run, multi metric).
 *
 * Uses per-metric bucket boundaries (like the AVG variant) so each metric's
 * step range is independently bucketed. lttb() runs per (logName, runId).
 */
async function queryRunMetricsMultiMetricBatchBucketedLttb(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runIds: number[];
    logNames: string[];
    buckets?: number;
    stepMin?: number;
    stepMax?: number;
    preview?: boolean;
  },
): Promise<Record<string, Record<number, BucketedMetricDataPoint[]>>> {
  const { organizationId, projectName, runIds, logNames, stepMin, stepMax, preview } = params;

  if (runIds.length === 0 || logNames.length === 0) return {};

  const numBuckets = params.buckets ?? (preview ? PREVIEW_BUCKETS : DEFAULT_BUCKETS);

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    logNames,
    numBuckets,
  };

  let whereClause = `
    tenantId = {tenantId: String}
    AND projectName = {projectName: String}
    AND runId IN ({runIds: Array(UInt64)})
    AND logName IN ({logNames: Array(String)})
  `;

  let mainStepRange = "";
  let bareStepRange = "";  // same filter without m. prefix, for unaliased queries
  const hasStepRange = stepMin !== undefined && stepMax !== undefined;
  if (hasStepRange) {
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    bareStepRange = ` AND step >= {stepMin: UInt64} AND step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // Build LTTB query with per-metric bucket boundaries
  let query: string;
  if (hasStepRange) {
    // Zoom: compute bucket width from the provided step range
    query = `
      WITH
        bucket_agg AS (
          SELECT
            m.logName AS logName,
            m.runId AS runId,
            intDiv(m.step - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
            any(toUInt64({stepMin: UInt64} + intDiv(m.step - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) * greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32}))))) AS step,
            argMin(m.time, m.step) AS time,
            avgIf(m.value, isFinite(m.value)) AS avg_value,
            minIf(m.value, isFinite(m.value)) AS minY,
            maxIf(m.value, isFinite(m.value)) AS maxY,
            toUInt64(count()) AS count,
            ${NF_FLAGS_SQL} AS nonFiniteFlags
          FROM mlop_metrics_v2 m FINAL
          WHERE ${whereClause}${mainStepRange}
          GROUP BY m.logName, m.runId, bucket
        ),
        lttb_selected AS (
          SELECT
            logName, runId,
            lttb({numBuckets: UInt32})(toFloat64(step), value) AS sampled_points
          FROM mlop_metrics_v2 FINAL
          WHERE ${whereClause}${bareStepRange} AND isFinite(value)
          GROUP BY logName, runId
        ),
        lttb_bucketed AS (
          SELECT
            ls.logName AS logName,
            ls.runId AS runId,
            intDiv(toUInt64(tupleElement(pt, 1)) - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
            tupleElement(pt, 2) AS lttb_value
          FROM lttb_selected ls
          ARRAY JOIN sampled_points AS pt
        ),
        lttb_per_bucket AS (
          SELECT logName, runId, bucket, toNullable(any(lttb_value)) AS lttb_value
          FROM lttb_bucketed
          GROUP BY logName, runId, bucket
        )
      SELECT
        ba.logName AS logName,
        ba.runId AS runId,
        ba.step AS step,
        ba.time AS time,
        if(lpb.lttb_value IS NOT NULL, lpb.lttb_value, ba.avg_value) AS value,
        ba.minY AS minY,
        ba.maxY AS maxY,
        ba.count AS count,
        ba.nonFiniteFlags AS nonFiniteFlags
      FROM bucket_agg ba
      LEFT JOIN lttb_per_bucket lpb ON ba.logName = lpb.logName AND ba.runId = lpb.runId AND ba.bucket = lpb.bucket
      ORDER BY ba.logName, ba.runId, ba.bucket ASC
    `;
  } else {
    // Non-zoom: per-metric bounds CTE from mlop_metric_summaries (arrayJoin
    // guarantees a row per requested logName even before first refresh).
    query = `
      WITH
        bounds AS (${buildSummaryBoundsBodyMultiMetric()}),
        params AS (
          SELECT logName, minStep,
            greatest(toUInt64(1), intDiv(maxStep - minStep + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
          FROM bounds
        ),
        bucket_agg AS (
          SELECT
            m.logName AS logName,
            m.runId AS runId,
            intDiv(m.step - p.minStep, p.bucketWidth) AS bucket,
            any(toUInt64(p.minStep + intDiv(m.step - p.minStep, p.bucketWidth) * p.bucketWidth)) AS step,
            argMin(m.time, m.step) AS time,
            avgIf(m.value, isFinite(m.value)) AS avg_value,
            minIf(m.value, isFinite(m.value)) AS minY,
            maxIf(m.value, isFinite(m.value)) AS maxY,
            toUInt64(count()) AS count,
            ${NF_FLAGS_SQL} AS nonFiniteFlags
          FROM mlop_metrics_v2 m FINAL
          INNER JOIN params p ON m.logName = p.logName
          WHERE ${whereClause}
          GROUP BY m.logName, m.runId, bucket
        ),
        lttb_selected AS (
          SELECT
            logName, runId,
            lttb({numBuckets: UInt32})(toFloat64(step), value) AS sampled_points
          FROM mlop_metrics_v2 FINAL
          WHERE ${whereClause} AND isFinite(value)
          GROUP BY logName, runId
        ),
        lttb_bucketed AS (
          SELECT
            ls.logName AS logName,
            ls.runId AS runId,
            intDiv(toUInt64(tupleElement(pt, 1)) - p.minStep, p.bucketWidth) AS bucket,
            tupleElement(pt, 2) AS lttb_value
          FROM lttb_selected ls
          INNER JOIN params p ON ls.logName = p.logName
          ARRAY JOIN sampled_points AS pt
        ),
        lttb_per_bucket AS (
          SELECT logName, runId, bucket, toNullable(any(lttb_value)) AS lttb_value
          FROM lttb_bucketed
          GROUP BY logName, runId, bucket
        )
      SELECT
        ba.logName AS logName,
        ba.runId AS runId,
        ba.step AS step,
        ba.time AS time,
        if(lpb.lttb_value IS NOT NULL, lpb.lttb_value, ba.avg_value) AS value,
        ba.minY AS minY,
        ba.maxY AS maxY,
        ba.count AS count,
        ba.nonFiniteFlags AS nonFiniteFlags
      FROM bucket_agg ba
      LEFT JOIN lttb_per_bucket lpb ON ba.logName = lpb.logName AND ba.runId = lpb.runId AND ba.bucket = lpb.bucket
      ORDER BY ba.logName, ba.runId, ba.bucket ASC
    `;
  }

  const result = await ch.query(query, queryParams);
  const rows = sanitizeBucketedRows(
    (await result.json()) as (BucketedMetricDataPoint & { logName: string; runId: number })[]
  );

  // Group by logName → runId
  const grouped: Record<string, Record<number, BucketedMetricDataPoint[]>> = {};
  for (const row of rows) {
    const byRun = grouped[row.logName] ?? (grouped[row.logName] = {});
    const arr = byRun[row.runId] ?? (byRun[row.runId] = []);
    arr.push({ step: row.step, time: row.time, value: row.value, minY: row.minY, maxY: row.maxY, count: row.count, nonFiniteFlags: row.nonFiniteFlags });
  }

  return grouped;
}
