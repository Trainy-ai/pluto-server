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
      FROM mlop_metrics
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
        FROM mlop_metrics
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
        FROM mlop_metrics
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
        FROM mlop_metrics
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
      FROM mlop_metrics
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
      FROM mlop_metrics
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
      FROM mlop_metrics
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
    dedup?: boolean;
  }
): Promise<BucketedMetricDataPoint[]> {
  const { organizationId, projectName, runId, logName, stepMin, stepMax, preview, algorithm, dedup } = params;

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

  // When dedup is enabled, use a subquery that takes the last-logged value per step.
  // The subquery reads from mlop_metrics directly (no alias), so use boundsStepRange
  // (bare `step`) not mainStepRange (`m.step`).
  const metricsSource = dedup
    ? `(SELECT step, argMax(value, time) AS value, max(time) AS ts
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
        GROUP BY step) m`
    : `mlop_metrics m`;
  const dedupWhere = dedup ? "1 = 1" : `${whereClause}${mainStepRange}`;
  const timeAgg = dedup ? "min(m.ts)" : "argMin(m.time, m.step)";

  // Non-zoom path: read pre-aggregated min/max step from mlop_metric_summaries
  // instead of scanning every row in mlop_metrics. Zoom path keeps the raw scan
  // because the bucket width must reflect the zoomed range.
  const boundsCte = stepMin === undefined || stepMax === undefined
    ? `bounds AS (
        SELECT min(min_step) AS minStep, max(max_step) AS maxStep
        FROM mlop_metric_summaries
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
      )`
    : `bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
      )`;

  const query = `
    WITH
      ${boundsCte}
    SELECT
      intDiv(m.step - b.minStep, greatest(toUInt64(1), intDiv(b.maxStep - b.minStep + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
      min(m.step) AS step,
      ${timeAgg} AS time,
      avgIf(m.value, isFinite(m.value)) AS value,
      minIf(m.value, isFinite(m.value)) AS minY,
      maxIf(m.value, isFinite(m.value)) AS maxY,
      toUInt64(count()) AS count,
      toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
    FROM ${metricsSource}
    CROSS JOIN bounds b
    WHERE ${dedupWhere}
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
    dedup?: boolean;
  }
): Promise<Record<number, BucketedMetricDataPoint[]>> {
  const { organizationId, projectName, runIds, logName, stepMin, stepMax, preview, algorithm, dedup } = params;

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

  // When dedup is enabled, use a subquery that takes the last-logged value per step.
  // Use boundsStepRange (bare `step`) inside the subquery, not mainStepRange (`m.step`).
  const metricsSource = dedup
    ? `(SELECT runId, step, argMax(value, time) AS value, max(time) AS ts
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
        GROUP BY runId, step) m`
    : `mlop_metrics m`;
  const dedupWhere = dedup ? "1 = 1" : `${whereClause}${mainStepRange}`;
  const timeAgg = dedup ? "min(m.ts)" : "argMin(m.time, m.step)";

  // When no zoom range is provided, the bounds CTE reads pre-aggregated min/max
  // step from mlop_metric_summaries (one row per (run, metric)) instead of
  // scanning all step rows in mlop_metrics. When zoomed, we must still scan
  // the raw table so the bucket width reflects the zoomed range.
  const boundsCte = stepMin === undefined || stepMax === undefined
    ? `bounds AS (
        SELECT min(min_step) AS minStep, max(max_step) AS maxStep
        FROM mlop_metric_summaries
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId IN ({runIds: Array(UInt64)})
          AND logName = {logName: String}
      )`
    : `bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
      )`;

  const query = `
    WITH
      ${boundsCte},
      params AS (
        SELECT minStep,
          greatest(toUInt64(1), intDiv(maxStep - minStep + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
        FROM bounds
      )
    SELECT
      m.runId AS runId,
      intDiv(m.step - p.minStep, p.bucketWidth) AS bucket,
      any(toUInt64(p.minStep + intDiv(m.step - p.minStep, p.bucketWidth) * p.bucketWidth)) AS step,
      ${timeAgg} AS time,
      avgIf(m.value, isFinite(m.value)) AS value,
      minIf(m.value, isFinite(m.value)) AS minY,
      maxIf(m.value, isFinite(m.value)) AS maxY,
      toUInt64(count()) AS count,
      toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
    FROM ${metricsSource}
    CROSS JOIN params p
    WHERE ${dedupWhere}
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
    dedup?: boolean;
  }
): Promise<Record<string, Record<number, BucketedMetricDataPoint[]>>> {
  const { organizationId, projectName, runIds, logNames, stepMin, stepMax, preview, algorithm, dedup } = params;

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
  let bareStepRange = "";  // same filter but without m. prefix, for use inside dedup subqueries
  const hasStepRange = stepMin !== undefined && stepMax !== undefined;
  if (hasStepRange) {
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    bareStepRange = ` AND step >= {stepMin: UInt64} AND step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // When dedup is enabled, use a subquery that takes the last-logged value per step
  // (by timestamp) before bucketing — eliminates duplicate values from distributed training.
  const metricsSource = dedup
    ? `(SELECT logName, runId, step, argMax(value, time) AS value, max(time) AS ts
        FROM mlop_metrics
        WHERE ${whereClause}${bareStepRange}
        GROUP BY logName, runId, step) m`
    : `mlop_metrics m`;
  const dedupWhereClause = dedup ? "1 = 1" : `${whereClause}`;
  const dedupMainStepRange = dedup ? "" : mainStepRange;
  // When dedup subquery is used, m.time is already an aggregate result (max(time)),
  // so we can't wrap it in argMin(). Use min(m.time) instead — it's equivalent since
  // each step has exactly one row after dedup.
  const timeAgg = dedup ? "min(m.ts)" : "argMin(m.time, m.step)";

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
        ${timeAgg} AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(count()) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM ${metricsSource}
      WHERE ${dedupWhereClause}${dedupMainStepRange}
      GROUP BY m.logName, m.runId, bucket
      ORDER BY m.logName, m.runId, bucket ASC
    `;
  } else {
    // Bounds CTE reads from mlop_metric_summaries (one pre-aggregated row per
    // run/metric pair) instead of scanning every step row in mlop_metrics.
    // dedup doesn't change the step range, only which value is kept per step,
    // so it's safe regardless of dedup mode.
    query = `
      WITH
        bounds AS (
          SELECT logName, min(min_step) AS minStep, max(max_step) AS maxStep
          FROM mlop_metric_summaries
          WHERE tenantId = {tenantId: String}
            AND projectName = {projectName: String}
            AND runId IN ({runIds: Array(UInt64)})
            AND logName IN ({logNames: Array(String)})
          GROUP BY logName
        ),
        params AS (
          SELECT logName, minStep,
            greatest(toUInt64(1), intDiv(maxStep - minStep + 1, toUInt64({numBuckets: UInt32}))) AS bucketWidth
          FROM bounds
        )
      SELECT
        m.logName AS logName,
        m.runId AS runId,
        intDiv(m.step - p.minStep, p.bucketWidth) AS bucket,
        any(toUInt64(p.minStep + intDiv(m.step - p.minStep, p.bucketWidth) * p.bucketWidth)) AS step,
        ${timeAgg} AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(count()) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM ${metricsSource}
      INNER JOIN params p ON m.logName = p.logName
      WHERE ${dedupWhereClause}
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
        FROM mlop_metrics
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
        FROM mlop_metrics
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
          FROM mlop_metrics
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
      FROM mlop_metrics
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
        FROM mlop_metrics
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
        FROM mlop_metrics
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
    dedup?: boolean;
  },
): Promise<BucketedMetricDataPoint[]> {
  const { organizationId, projectName, runId, logName, stepMin, stepMax, preview, dedup } = params;
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

  // When dedup is enabled, add a CTE that deduplicates before bucketing/LTTB.
  // Use boundsStepRange (bare `step`) inside the CTE, not mainStepRange (`m.step`).
  const dedupCte = dedup
    ? `deduped AS (
        SELECT step, argMax(value, time) AS value, max(time) AS ts
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
        GROUP BY step
      ),`
    : "";
  const dataSrc = dedup ? "deduped" : "mlop_metrics";
  const dataWhere = dedup ? "1 = 1" : `${whereClause}${mainStepRange}`;
  const timeAgg = dedup ? "min(m.ts)" : "argMin(m.time, m.step)";

  // Non-zoom: use mlop_metric_summaries for bounds. Zoom: raw mlop_metrics.
  const boundsCte = stepMin === undefined || stepMax === undefined
    ? `bounds AS (
        SELECT min(min_step) AS minStep, max(max_step) AS maxStep
        FROM mlop_metric_summaries
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId = {runId: UInt64}
          AND logName = {logName: String}
      )`
    : `bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
      )`;

  const query = `
    WITH
      ${dedupCte}
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
          ${timeAgg} AS time,
          avgIf(m.value, isFinite(m.value)) AS avg_value,
          minIf(m.value, isFinite(m.value)) AS minY,
          maxIf(m.value, isFinite(m.value)) AS maxY,
          toUInt64(count()) AS count,
          ${NF_FLAGS_SQL} AS nonFiniteFlags
        FROM ${dataSrc} m
        CROSS JOIN params p
        WHERE ${dataWhere}
        GROUP BY bucket
      ),
      lttb_selected AS (
        SELECT lttb({numBuckets: UInt32})(toFloat64(m.step), m.value) AS sampled_points
        FROM ${dataSrc} m
        WHERE ${dataWhere} AND isFinite(m.value)
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
    dedup?: boolean;
  },
): Promise<Record<number, BucketedMetricDataPoint[]>> {
  const { organizationId, projectName, runIds, logName, stepMin, stepMax, preview, dedup } = params;
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

  // When dedup is enabled, add a CTE that deduplicates before bucketing/LTTB.
  // Use boundsStepRange (bare `step`) inside the CTE, not mainStepRange (`m.step`).
  const dedupCte = dedup
    ? `deduped AS (
        SELECT runId, step, argMax(value, time) AS value, max(time) AS ts
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
        GROUP BY runId, step
      ),`
    : "";
  const dataSrc = dedup ? "deduped" : "mlop_metrics";
  const dataWhere = dedup ? "1 = 1" : `${whereClause}${mainStepRange}`;
  const lttbWhere = dedup ? "isFinite(value)" : `${whereClause}${boundsStepRange} AND isFinite(value)`;
  const timeAgg = dedup ? "min(m.ts)" : "argMin(m.time, m.step)";

  // Non-zoom: use mlop_metric_summaries for bounds. Zoom: raw mlop_metrics.
  const boundsCte = stepMin === undefined || stepMax === undefined
    ? `bounds AS (
        SELECT min(min_step) AS minStep, max(max_step) AS maxStep
        FROM mlop_metric_summaries
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND runId IN ({runIds: Array(UInt64)})
          AND logName = {logName: String}
      )`
    : `bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
      )`;

  const query = `
    WITH
      ${dedupCte}
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
          ${timeAgg} AS time,
          avgIf(m.value, isFinite(m.value)) AS avg_value,
          minIf(m.value, isFinite(m.value)) AS minY,
          maxIf(m.value, isFinite(m.value)) AS maxY,
          toUInt64(count()) AS count,
          ${NF_FLAGS_SQL} AS nonFiniteFlags
        FROM ${dataSrc} m
        CROSS JOIN params p
        WHERE ${dataWhere}
        GROUP BY m.runId, bucket
      ),
      lttb_selected AS (
        SELECT
          runId,
          lttb({numBuckets: UInt32})(toFloat64(step), value) AS sampled_points
        FROM ${dataSrc}
        WHERE ${lttbWhere}
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
    dedup?: boolean;
  },
): Promise<Record<string, Record<number, BucketedMetricDataPoint[]>>> {
  const { organizationId, projectName, runIds, logNames, stepMin, stepMax, preview, dedup } = params;

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
  let bareStepRange = "";  // same filter without m. prefix, for use inside dedup CTEs and unaliased queries
  const hasStepRange = stepMin !== undefined && stepMax !== undefined;
  if (hasStepRange) {
    mainStepRange = ` AND m.step >= {stepMin: UInt64} AND m.step <= {stepMax: UInt64}`;
    bareStepRange = ` AND step >= {stepMin: UInt64} AND step <= {stepMax: UInt64}`;
    queryParams.stepMin = stepMin;
    queryParams.stepMax = stepMax;
  }

  // When dedup is enabled, add a CTE that deduplicates before bucketing/LTTB
  const dedupCte = dedup
    ? `deduped AS (
        SELECT logName, runId, step, argMax(value, time) AS value, max(time) AS ts
        FROM mlop_metrics
        WHERE ${whereClause}${bareStepRange}
        GROUP BY logName, runId, step
      ),`
    : "";
  const dataSrc = dedup ? "deduped" : "mlop_metrics";
  const dataWhere = dedup ? "1 = 1" : `${whereClause}${mainStepRange}`;
  const dataWhereNoAlias = dedup ? "1 = 1" : `${whereClause}${bareStepRange}`;
  const nonZoomDataWhere = dedup ? "1 = 1" : whereClause;
  const timeAgg = dedup ? "min(m.ts)" : "argMin(m.time, m.step)";

  // Build LTTB query with per-metric bucket boundaries
  let query: string;
  if (hasStepRange) {
    // Zoom: compute bucket width from the provided step range
    query = `
      WITH
        ${dedupCte}
        bucket_agg AS (
          SELECT
            m.logName AS logName,
            m.runId AS runId,
            intDiv(m.step - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
            any(toUInt64({stepMin: UInt64} + intDiv(m.step - {stepMin: UInt64}, greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32})))) * greatest(toUInt64(1), intDiv({stepMax: UInt64} - {stepMin: UInt64} + 1, toUInt64({numBuckets: UInt32}))))) AS step,
            ${timeAgg} AS time,
            avgIf(m.value, isFinite(m.value)) AS avg_value,
            minIf(m.value, isFinite(m.value)) AS minY,
            maxIf(m.value, isFinite(m.value)) AS maxY,
            toUInt64(count()) AS count,
            ${NF_FLAGS_SQL} AS nonFiniteFlags
          FROM ${dataSrc} m
          WHERE ${dataWhere}
          GROUP BY m.logName, m.runId, bucket
        ),
        lttb_selected AS (
          SELECT
            logName, runId,
            lttb({numBuckets: UInt32})(toFloat64(step), value) AS sampled_points
          FROM ${dataSrc}
          WHERE ${dataWhereNoAlias} AND isFinite(value)
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
    // Non-zoom: per-metric bounds CTE
    const nonZoomDedupCte = dedup
      ? `deduped AS (
          SELECT logName, runId, step, argMax(value, time) AS value, max(time) AS ts
          FROM mlop_metrics
          WHERE ${whereClause}
          GROUP BY logName, runId, step
        ),`
      : "";

    query = `
      WITH
        ${nonZoomDedupCte}
        bounds AS (
          SELECT logName, min(min_step) AS minStep, max(max_step) AS maxStep
          FROM mlop_metric_summaries
          WHERE tenantId = {tenantId: String}
            AND projectName = {projectName: String}
            AND runId IN ({runIds: Array(UInt64)})
            AND logName IN ({logNames: Array(String)})
          GROUP BY logName
        ),
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
            ${timeAgg} AS time,
            avgIf(m.value, isFinite(m.value)) AS avg_value,
            minIf(m.value, isFinite(m.value)) AS minY,
            maxIf(m.value, isFinite(m.value)) AS maxY,
            toUInt64(count()) AS count,
            ${NF_FLAGS_SQL} AS nonFiniteFlags
          FROM ${dataSrc} m
          INNER JOIN params p ON m.logName = p.logName
          WHERE ${nonZoomDataWhere}
          GROUP BY m.logName, m.runId, bucket
        ),
        lttb_selected AS (
          SELECT
            logName, runId,
            lttb({numBuckets: UInt32})(toFloat64(step), value) AS sampled_points
          FROM ${dataSrc}
          WHERE ${nonZoomDataWhere} AND isFinite(value)
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
