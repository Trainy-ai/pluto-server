/**
 * Query functions for the mlop_metric_summaries AggregatingMergeTree table.
 * Provides pre-computed MIN/MAX/AVG/LAST/VARIANCE per (run, metric).
 */

import type { clickhouse } from "../clickhouse";
import { validateRe2Regex } from "../regex-validation";

export type MetricAggregation = "MIN" | "MAX" | "AVG" | "LAST" | "VARIANCE";

/** SQL expression for each aggregation type (applied on top of AggregatingMergeTree partial state) */
function aggExpression(agg: MetricAggregation): string {
  switch (agg) {
    case "MIN":
      return "min(min_value)";
    case "MAX":
      return "max(max_value)";
    case "AVG":
      return "sum(sum_value) / sum(count_value)";
    case "LAST":
      return "argMaxMerge(last_value)";
    case "VARIANCE":
      return "(sum(sum_sq_value)/sum(count_value)) - pow(sum(sum_value)/sum(count_value), 2)";
  }
}

// ---------------------------------------------------------------------------
// Batch metric summaries — multiple metrics for a set of runs
// ---------------------------------------------------------------------------

export interface MetricSpec {
  logName: string;
  aggregation: MetricAggregation;
}

/**
 * Fetch summaries for multiple metrics across a set of runs in one query.
 * Returns Map<runId, Map<"logName|AGG", value>>.
 *
 * Uses a single GROUP BY (runId, logName) query that computes all 5
 * aggregations at once, then maps results back to the requested specs.
 * This avoids N separate UNION ALL subqueries (one per metric spec).
 */
export async function queryMetricSummariesBatch(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    metrics: MetricSpec[];
    runIds: number[];
  },
): Promise<Map<number, Map<string, number>>> {
  const { organizationId, projectName, metrics, runIds } = params;

  if (metrics.length === 0 || runIds.length === 0) {
    return new Map();
  }

  // Collect unique logNames from all requested specs
  const logNames = [...new Set(metrics.map((m) => m.logName))];

  // Build which aggregations are needed per logName for result mapping
  const specsByLogName = new Map<string, Set<MetricAggregation>>();
  for (const m of metrics) {
    if (!specsByLogName.has(m.logName)) {
      specsByLogName.set(m.logName, new Set());
    }
    specsByLogName.get(m.logName)!.add(m.aggregation);
  }

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    runIds,
    logNames,
  };

  // Single query: GROUP BY (runId, logName), compute all aggregations
  const query = `
    SELECT
      runId,
      logName AS metric_name,
      ${aggExpression("MIN")} AS min_val,
      ${aggExpression("MAX")} AS max_val,
      ${aggExpression("AVG")} AS avg_val,
      ${aggExpression("LAST")} AS last_val,
      ${aggExpression("VARIANCE")} AS var_val
    FROM mlop_metric_summaries
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND logName IN ({logNames: Array(String)})
      AND runId IN ({runIds: Array(UInt64)})
    GROUP BY runId, logName
  `;

  const result = await ch.query(query, queryParams);
  const rows = (await result.json()) as {
    runId: number;
    metric_name: string;
    min_val: number;
    max_val: number;
    avg_val: number;
    last_val: number;
    var_val: number;
  }[];

  // Map column names to aggregation types
  const aggToCol: Record<MetricAggregation, keyof typeof rows[number]> = {
    MIN: "min_val",
    MAX: "max_val",
    AVG: "avg_val",
    LAST: "last_val",
    VARIANCE: "var_val",
  };

  const resultMap = new Map<number, Map<string, number>>();
  for (const row of rows) {
    if (!resultMap.has(row.runId)) {
      resultMap.set(row.runId, new Map());
    }
    const runMap = resultMap.get(row.runId)!;

    // Only include aggregations that were actually requested for this logName
    const requestedAggs = specsByLogName.get(row.metric_name);
    if (requestedAggs) {
      for (const agg of requestedAggs) {
        runMap.set(`${row.metric_name}|${agg}`, row[aggToCol[agg]] as number);
      }
    }
  }

  return resultMap;
}

// ---------------------------------------------------------------------------
// Argmin/argmax step — find the step where a metric's value is min/max
// ---------------------------------------------------------------------------

/**
 * For each run, find the step where a metric reaches its min and max value.
 * Uses ClickHouse's built-in argMin/argMax aggregate functions on mlop_metrics.
 *
 * If `requireImage` is true, the search is restricted to steps where an image
 * file also exists for that run — useful when pinning images to the "best step"
 * (otherwise the argmin/argmax step may not have any image to show).
 *
 * Returns Map<runId, { argminStep, argmaxStep }>.
 */
export async function queryArgminArgmaxSteps(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    logName: string;
    runIds: number[];
    requireImage?: boolean;
  },
): Promise<Map<number, { argminStep: number; argmaxStep: number }>> {
  const { organizationId, projectName, logName, runIds, requireImage } = params;

  if (runIds.length === 0) return new Map();

  // When requireImage is true, restrict to (runId, step) pairs where an
  // actual image file exists for the same run+step. mlop_files contains
  // all file types (png, wav, mp4, md, etc.) — filter to image types only
  // so we don't match steps that only have e.g. audio or checkpoint files.
  const imageFilter = requireImage
    ? `
        AND (runId, step) IN (
          SELECT DISTINCT runId, step
          FROM mlop_files
          WHERE tenantId = {tenantId: String}
            AND projectName = {projectName: String}
            AND runId IN ({runIds: Array(UInt64)})
            AND (
              startsWith(fileType, 'image/')
              OR fileType IN ('png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp')
            )
        )
      `
    : "";

  const query = `
    SELECT
      runId,
      argMin(step, value) AS argmin_step,
      argMax(step, value) AS argmax_step
    FROM mlop_metrics
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND logName = {logName: String}
      AND runId IN ({runIds: Array(UInt64)})
      ${imageFilter}
    GROUP BY runId
  `;

  const result = await ch.query(query, {
    tenantId: organizationId,
    projectName,
    logName,
    runIds,
  });

  const rows = (await result.json()) as {
    runId: number;
    argmin_step: number;
    argmax_step: number;
  }[];

  const resultMap = new Map<number, { argminStep: number; argmaxStep: number }>();
  for (const row of rows) {
    resultMap.set(row.runId, {
      argminStep: row.argmin_step,
      argmaxStep: row.argmax_step,
    });
  }
  return resultMap;
}

// ---------------------------------------------------------------------------
// Distinct metric names in a project
// ---------------------------------------------------------------------------

export async function queryDistinctMetrics(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    search?: string;
    regex?: string;
    limit?: number;
    runIds?: number[];
  },
): Promise<string[]> {
  const { organizationId, projectName, search, regex, limit = 500, runIds } = params;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    limit,
  };

  let searchFilter = "";
  let orderClause = "ORDER BY logName ASC";

  const trimmedRegex = regex?.trim();
  if (trimmedRegex) {
    // ClickHouse match() uses re2 regex engine — validate before sending
    // to prevent CANNOT_COMPILE_REGEXP errors (Code 427).
    const re2Check = validateRe2Regex(trimmedRegex);
    if (!re2Check.valid) {
      console.warn(
        `[queryDistinctMetrics] Rejected invalid re2 regex: ${re2Check.reason} — pattern: ${trimmedRegex.slice(0, 100)}`,
      );
      return [];
    }
    searchFilter = `AND match(logName, {regex: String})`;
    queryParams.regex = trimmedRegex;
  } else if (search && search.trim()) {
    const trimmed = search.trim();
    // Fuzzy match with Levenshtein distance: allow 1 edit for short terms (<4 chars),
    // 2 edits for longer terms. Lowered from 2/3 to reduce false positives.
    searchFilter = `AND (multiFuzzyMatchAny(lower(logName), if(length({search: String}) < 4, 1, 2), [lower({search: String})]) = 1
         OR logName ILIKE {searchPattern: String})`;
    queryParams.search = trimmed;
    queryParams.searchPattern = `%${trimmed}%`;
    orderClause = "ORDER BY logName ILIKE {searchPattern: String} DESC, logName ASC";
  }

  let runIdFilter = "";
  if (runIds && runIds.length > 0) {
    runIdFilter = `AND runId IN ({runIds: Array(UInt64)})`;
    queryParams.runIds = runIds;
  }

  // When scoped to specific runs, query mlop_metrics (the source table) instead of
  // mlop_metric_summaries. The materialized view that populates summaries has a
  // WHERE isFinite(value) filter, so metrics whose values are all non-finite
  // (NaN/Inf) for a run won't appear in the summaries table even though the
  // metric data exists. The mlop_metrics primary index on
  // (tenantId, projectName, runId, logGroup, logName) keeps this efficient.
  const table = runIds && runIds.length > 0
    ? "mlop_metrics"
    : "mlop_metric_summaries";

  const query = `
    SELECT DISTINCT logName
    FROM ${table}
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      ${searchFilter}
      ${runIdFilter}
    ${orderClause}
    LIMIT {limit: UInt32}
  `;

  try {
    const result = await ch.query(query, queryParams);
    const rows = (await result.json()) as { logName: string }[];
    return rows.map((r) => r.logName);
  } catch (error: unknown) {
    // Gracefully handle ClickHouse regex compilation errors (Code 427)
    // instead of propagating 500s to the client.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("CANNOT_COMPILE_REGEXP") || message.includes("427")) {
      console.warn(
        `[queryDistinctMetrics] ClickHouse regex error: ${message.slice(0, 200)}`,
      );
      return [];
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Metric sort query — returns sorted runIds from ClickHouse
// ---------------------------------------------------------------------------

export interface MetricFilterSpec {
  logName: string;
  aggregation: MetricAggregation;
  operator: string;
  values: unknown[];
}

/**
 * Query ClickHouse for run IDs sorted by a metric aggregation.
 * Supports optional metric filters and a candidate run ID set (from PG pre-filtering).
 */
export async function queryMetricSortedRunIds(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    sortLogName: string;
    sortAggregation: MetricAggregation;
    sortDirection: "ASC" | "DESC";
    limit: number;
    offset: number;
    candidateRunIds?: number[];
    metricFilters?: MetricFilterSpec[];
  },
): Promise<{ runId: number; sortValue: number }[]> {
  const {
    organizationId,
    projectName,
    sortLogName,
    sortAggregation,
    sortDirection,
    limit,
    offset,
    candidateRunIds,
    metricFilters,
  } = params;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    sortLogName,
    limit,
    offset,
  };

  let candidateFilter = "";
  if (candidateRunIds && candidateRunIds.length > 0) {
    candidateFilter = "AND runId IN ({candidateRunIds: Array(UInt64)})";
    queryParams.candidateRunIds = candidateRunIds;
  }

  // Build HAVING clause for metric filters
  const havingClauses: string[] = [];
  if (metricFilters && metricFilters.length > 0) {
    for (let i = 0; i < metricFilters.length; i++) {
      const mf = metricFilters[i];
      const logNameParam = `mf_logName_${i}`;
      queryParams[logNameParam] = mf.logName;

      // For each metric filter, add a subquery-based HAVING condition
      // We check it via a separate correlated condition
      const aggExpr = aggExpression(mf.aggregation);
      const cond = buildMetricFilterCondition(aggExpr, mf.operator, mf.values, queryParams, `mf_${i}`);
      if (cond) {
        havingClauses.push(cond);
      }
    }
  }

  // If metric filters target different logNames than the sort logName,
  // we need a different approach: use sub-selects or INTERSECT.
  // For simplicity, we use a CTE approach with INTERSECT.

  // Step 1: Get runIds that pass all metric filters
  let filterCTE = "";
  if (metricFilters && metricFilters.length > 0) {
    const filterSubqueries: string[] = [];
    for (let i = 0; i < metricFilters.length; i++) {
      const mf = metricFilters[i];
      const logNameParam = `mf_logName_${i}`;
      const aggExpr = aggExpression(mf.aggregation);
      const havingCond = buildMetricFilterCondition(aggExpr, mf.operator, mf.values, queryParams, `mf_${i}`);
      if (!havingCond) continue;

      filterSubqueries.push(`
        SELECT runId
        FROM mlop_metric_summaries
        WHERE tenantId = {tenantId: String}
          AND projectName = {projectName: String}
          AND logName = {${logNameParam}: String}
          ${candidateFilter}
        GROUP BY runId
        HAVING ${havingCond}
      `);
    }
    if (filterSubqueries.length > 0) {
      filterCTE = `filtered_runs AS (
        ${filterSubqueries.join(" INTERSECT ")}
      ),`;
    }
  }

  const filterJoin = filterCTE
    ? "AND runId IN (SELECT runId FROM filtered_runs)"
    : "";

  const sortAggExpr = aggExpression(sortAggregation);

  const query = `
    WITH ${filterCTE}
    sorted AS (
      SELECT
        runId,
        ${sortAggExpr} AS sort_value
      FROM mlop_metric_summaries
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND logName = {sortLogName: String}
        ${candidateFilter}
        ${filterJoin}
      GROUP BY runId
      ORDER BY sort_value ${sortDirection}
      LIMIT {limit: UInt32}
      OFFSET {offset: UInt32}
    )
    SELECT runId, sort_value AS sortValue FROM sorted
  `;

  const t0 = performance.now();
  const result = await ch.query(query, queryParams);
  const t1 = performance.now();
  const rows = (await result.json()) as { runId: number; sortValue: number }[];
  const t2 = performance.now();
  console.log(`[queryMetricSortedRunIds] ${params.sortLogName} ${params.sortAggregation} — CH query: ${(t1-t0).toFixed(0)}ms, JSON parse: ${(t2-t1).toFixed(0)}ms, ${rows.length} rows`);
  return rows;
}

/**
 * Query ClickHouse for run IDs matching metric filters (no sort — just filtering).
 * Used when sort is by a non-metric column but metric filters are active.
 */
export async function queryMetricFilteredRunIds(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    metricFilters: MetricFilterSpec[];
    candidateRunIds?: number[];
  },
): Promise<number[]> {
  const { organizationId, projectName, metricFilters, candidateRunIds } = params;

  if (metricFilters.length === 0) return [];

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
  };

  let candidateFilter = "";
  if (candidateRunIds && candidateRunIds.length > 0) {
    candidateFilter = "AND runId IN ({candidateRunIds: Array(UInt64)})";
    queryParams.candidateRunIds = candidateRunIds;
  }

  const subqueries: string[] = [];
  for (let i = 0; i < metricFilters.length; i++) {
    const mf = metricFilters[i];
    const logNameParam = `mf_logName_${i}`;
    queryParams[logNameParam] = mf.logName;

    const aggExpr = aggExpression(mf.aggregation);
    const havingCond = buildMetricFilterCondition(aggExpr, mf.operator, mf.values, queryParams, `mf_${i}`);
    if (!havingCond) continue;

    subqueries.push(`
      SELECT runId
      FROM mlop_metric_summaries
      WHERE tenantId = {tenantId: String}
        AND projectName = {projectName: String}
        AND logName = {${logNameParam}: String}
        ${candidateFilter}
      GROUP BY runId
      HAVING ${havingCond}
    `);
  }

  if (subqueries.length === 0) return [];

  const query = subqueries.join(" INTERSECT ");
  const result = await ch.query(query, queryParams);
  const rows = (await result.json()) as { runId: number }[];
  return rows.map((r) => r.runId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetricFilterCondition(
  aggExpr: string,
  operator: string,
  values: unknown[],
  queryParams: Record<string, unknown>,
  prefix: string,
): string | null {
  const v0 = values[0] != null ? Number(values[0]) : NaN;

  switch (operator) {
    case "is":
    case "=": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} = {${prefix}_v0: Float64}`;
    }
    case "is not":
    case "!=": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} != {${prefix}_v0: Float64}`;
    }
    case "is greater than":
    case ">": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} > {${prefix}_v0: Float64}`;
    }
    case "is less than":
    case "<": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} < {${prefix}_v0: Float64}`;
    }
    case "is greater than or equal to":
    case ">=": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} >= {${prefix}_v0: Float64}`;
    }
    case "is less than or equal to":
    case "<=": {
      if (isNaN(v0)) return null;
      queryParams[`${prefix}_v0`] = v0;
      return `${aggExpr} <= {${prefix}_v0: Float64}`;
    }
    case "is between": {
      if (isNaN(v0)) return null;
      const v1 = values[1] != null ? Number(values[1]) : NaN;
      if (isNaN(v1)) return null;
      queryParams[`${prefix}_v0`] = v0;
      queryParams[`${prefix}_v1`] = v1;
      return `${aggExpr} BETWEEN {${prefix}_v0: Float64} AND {${prefix}_v1: Float64}`;
    }
    case "is not between": {
      if (isNaN(v0)) return null;
      const v1 = values[1] != null ? Number(values[1]) : NaN;
      if (isNaN(v1)) return null;
      queryParams[`${prefix}_v0`] = v0;
      queryParams[`${prefix}_v1`] = v1;
      return `${aggExpr} NOT BETWEEN {${prefix}_v0: Float64} AND {${prefix}_v1: Float64}`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Single-run metric latest values (for file view)
// ---------------------------------------------------------------------------

export interface RunMetricValue {
  logName: string;
  lastValue: number;
  minValue: number;
  maxValue: number;
  avgValue: number;
  count: number;
}

/**
 * Fetch the latest value (and summary stats) for ALL metrics of a single run.
 * Used by the file view to display metrics alongside files (Neptune-style).
 */
export async function queryRunMetricValues(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    runId: number;
    limit?: number;
  },
): Promise<RunMetricValue[]> {
  const { organizationId, projectName, runId, limit = 1000 } = params;

  const query = `
    SELECT
      logName,
      ${aggExpression("LAST")} AS lastValue,
      ${aggExpression("MIN")} AS minValue,
      ${aggExpression("MAX")} AS maxValue,
      ${aggExpression("AVG")} AS avgValue,
      sum(count_value) AS count
    FROM mlop_metric_summaries
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND runId = {runId: UInt64}
    GROUP BY logName
    ORDER BY logName ASC
    LIMIT {limit: UInt32}
  `;

  const result = await ch.query(query, {
    tenantId: organizationId,
    projectName,
    runId,
    limit,
  });

  return (await result.json()) as RunMetricValue[];
}
