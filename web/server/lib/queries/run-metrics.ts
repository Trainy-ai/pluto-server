/**
 * Shared query function for fetching run metrics from ClickHouse.
 * Used by both tRPC procedures and OpenAPI endpoints.
 */

import type { clickhouse } from "../clickhouse";
import { getLogGroupName } from "../utilts";

// Maximum number of data points to return per metric series.
// The frontend does LTTB downsampling with min/max envelope rendering,
// so 10k points is enough for high-quality charts and zoom-aware re-downsampling.
// This keeps individual metric responses under ~500KB uncompressed.
const DEFAULT_MAX_POINTS = 10_000;

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
    SELECT logName, logGroup, value, time, step
    FROM counted
    WHERE total_rows <= {limit: UInt32}
       OR rn % ceiling(total_rows / {limit: UInt32}) = 1
       OR rn = total_rows
    ORDER BY logName, step ASC
  `;
  queryParams.limit = limit;

  const result = await ch.query(query, queryParams);
  return (await result.json()) as RunMetricEntry[];
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
): Promise<{ value: number; time: string; step: number }[]> {
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
        SELECT value, time, step
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
      return (await result.json()) as { value: number; time: string; step: number }[];
    }

    // Fast preview path for step ranges: stride-based sampling, no window functions.
    // Selects every Nth step across the full zoom range so data appears everywhere
    // at once rather than filling in left-to-right (which LIMIT would do).
    if (preview && effectiveLimit > 0) {
      const query = `
        SELECT value, time, step
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
      return (await result.json()) as { value: number; time: string; step: number }[];
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
      SELECT value, time, step
      FROM counted
      WHERE total_rows <= ${effectiveLimit}
         OR rn % ceiling(total_rows / ${effectiveLimit}) = 1
         OR rn = total_rows
      ORDER BY step ASC
    `;

    const result = await ch.query(query, queryParams);
    return (await result.json()) as { value: number; time: string; step: number }[];
  }

  // Overview query: when maxPoints=0, return all data without sampling
  if (effectiveLimit === 0) {
    const query = `
      SELECT value, time, step
      FROM mlop_metrics
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND runId = {runId: UInt64}
        AND logName = {logName: String}
        AND logGroup = {logGroup: String}
      ORDER BY step ASC
    `;
    const result = await ch.query(query, queryParams);
    return (await result.json()) as { value: number; time: string; step: number }[];
  }

  // Fast preview path: simple LIMIT scan using primary key index, no window functions.
  // Returns the first N chronological points — good enough for a quick shape preview
  // that gets replaced by properly-sampled data moments later.
  if (preview && effectiveLimit > 0) {
    const query = `
      SELECT value, time, step
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
    return (await result.json()) as { value: number; time: string; step: number }[];
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
    SELECT value, time, step
    FROM counted
    WHERE total_rows <= ${effectiveLimit}
       OR rn % ceiling(total_rows / ${effectiveLimit}) = 1
       OR rn = total_rows
    ORDER BY step ASC
  `;

  const result = await ch.query(query, queryParams);
  return (await result.json()) as { value: number; time: string; step: number }[];
}

/**
 * Batch query metrics for multiple runs by logName in a SINGLE ClickHouse query.
 * Returns a map of runId → data points.
 *
 * This reduces N individual queries (one per run) to 1 query, which is critical
 * for comparison pages with 50-100 runs × multiple charts.
 */
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
): Promise<Record<number, { value: number; time: string; step: number }[]>> {
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
        SELECT runId, value, time, step
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
        SELECT runId, value, time, step
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
        SELECT runId, value, time, step FROM counted
        WHERE total_rows <= ${effectiveLimit}
           OR rn % ceiling(total_rows / ${effectiveLimit}) = 1
           OR rn = total_rows
        ORDER BY runId, step ASC
      `;
    }
  } else if (effectiveLimit === 0) {
    // No sampling — return all data
    query = `
      SELECT runId, value, time, step
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
      SELECT runId, value, time, step FROM numbered
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
      SELECT runId, value, time, step FROM counted
      WHERE total_rows <= ${effectiveLimit}
         OR rn % ceiling(total_rows / ${effectiveLimit}) = 1
         OR rn = total_rows
      ORDER BY runId, step ASC
    `;
  }

  const result = await ch.query(query, queryParams);
  const rows = (await result.json()) as { runId: number; value: number; time: string; step: number }[];

  // Group flat result set by runId
  const grouped: Record<number, { value: number; time: string; step: number }[]> = {};
  for (const row of rows) {
    const arr = grouped[row.runId] ?? (grouped[row.runId] = []);
    arr.push({ value: row.value, time: row.time, step: row.step });
  }

  return grouped;
}
