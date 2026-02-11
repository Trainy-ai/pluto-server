/**
 * Query functions for the mlop_metric_summaries AggregatingMergeTree table.
 * Provides pre-computed MIN/MAX/AVG/LAST/VARIANCE per (run, metric).
 */

import type { clickhouse } from "../clickhouse";

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
// Distinct metric names in a project
// ---------------------------------------------------------------------------

export async function queryDistinctMetrics(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    search?: string;
    limit?: number;
    runIds?: number[];
  },
): Promise<string[]> {
  const { organizationId, projectName, search, limit = 500, runIds } = params;

  const queryParams: Record<string, unknown> = {
    tenantId: organizationId,
    projectName,
    limit,
  };

  let searchFilter = "";
  if (search && search.trim()) {
    searchFilter = "AND logName ILIKE {search: String}";
    queryParams.search = `%${search.trim()}%`;
  }

  let runIdFilter = "";
  if (runIds && runIds.length > 0) {
    runIdFilter = `AND runId IN ({runIds: Array(UInt64)})`;
    queryParams.runIds = runIds;
  }

  const query = `
    SELECT DISTINCT logName
    FROM mlop_metric_summaries
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      ${searchFilter}
      ${runIdFilter}
    ORDER BY logName ASC
    LIMIT {limit: UInt32}
  `;

  const result = await ch.query(query, queryParams);
  const rows = (await result.json()) as { logName: string }[];
  return rows.map((r) => r.logName);
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

  const result = await ch.query(query, queryParams);
  return (await result.json()) as { runId: number; sortValue: number }[];
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
