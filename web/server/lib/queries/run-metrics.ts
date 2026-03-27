/**
 * Shared query function for fetching run metrics from ClickHouse.
 * Used by both tRPC procedures and OpenAPI endpoints.
 */

import type { clickhouse } from "../clickhouse";
import { getLogGroupName } from "../utilts";

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
  }
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

  const query = `
    WITH
      bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
      )
    SELECT
      intDiv(m.step - b.minStep, greatest(toUInt64(1), intDiv(b.maxStep - b.minStep + 1, toUInt64({numBuckets: UInt32})))) AS bucket,
      min(m.step) AS step,
      argMin(m.time, m.step) AS time,
      avgIf(m.value, isFinite(m.value)) AS value,
      minIf(m.value, isFinite(m.value)) AS minY,
      maxIf(m.value, isFinite(m.value)) AS maxY,
      toUInt64(count()) AS count,
      toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
    FROM mlop_metrics m
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
  }
): Promise<Record<number, BucketedMetricDataPoint[]>> {
  const { organizationId, projectName, runIds, logName, stepMin, stepMax, preview } = params;

  if (runIds.length === 0) return {};

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

  const query = `
    WITH
      bounds AS (
        SELECT min(step) AS minStep, max(step) AS maxStep
        FROM mlop_metrics
        WHERE ${whereClause}${boundsStepRange}
      ),
      params AS (
        SELECT minStep,
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
    FROM mlop_metrics m
    CROSS JOIN params p
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
  }
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
      FROM mlop_metrics m
      WHERE ${whereClause}${mainStepRange}
      GROUP BY m.logName, m.runId, bucket
      ORDER BY m.logName, m.runId, bucket ASC
    `;
  } else {
    query = `
      WITH
        bounds AS (
          SELECT logName, min(step) AS minStep, max(step) AS maxStep
          FROM mlop_metrics
          WHERE ${whereClause}
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
        argMin(m.time, m.step) AS time,
        avgIf(m.value, isFinite(m.value)) AS value,
        minIf(m.value, isFinite(m.value)) AS minY,
        maxIf(m.value, isFinite(m.value)) AS maxY,
        toUInt64(count()) AS count,
        toUInt8((countIf(isNaN(m.value)) > 0) + (countIf(isInfinite(m.value) AND m.value > 0) > 0) * 2 + (countIf(isInfinite(m.value) AND m.value < 0) > 0) * 4) AS nonFiniteFlags
      FROM mlop_metrics m
      INNER JOIN params p ON m.logName = p.logName
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
