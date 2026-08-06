import type { clickhouse } from "../../../lib/clickhouse";

/**
 * Final logged value of one metric, per run, read live from `mlop_metrics`.
 *
 * Deliberately *not* `queryMetricSummariesBatch`. That reads
 * `mlop_metric_summaries_v2`, which is fed by a `REFRESH EVERY 5 MINUTE`
 * materialized view — so for up to five minutes after a sweep finishes, its
 * runs have no summary row and every objective renders as "—". That is exactly
 * the moment someone opens the sweep page, so the staleness lands on the
 * primary use case. Measured on a freshly-seeded 24-run project: 240 raw metric
 * rows present, 5 summary rows.
 *
 * Reading raw is affordable *here* because a sweep is a bounded set of runs and
 * a single metric: `mlop_metrics` is sorted by
 * `(tenantId, projectName, runId, logGroup, logName, time, step)`, so an
 * explicit `runId IN (...)` plus `logName =` uses the sort key rather than
 * scanning. This would not be an acceptable pattern for a project-wide query —
 * that is what the summaries table is for.
 *
 * `argMax(value, step)` is the objective: the value at the highest step is what
 * the run converged to, matching what the SDK's own bayes seeding reads back.
 */
export async function queryFinalMetricValues(
  ch: typeof clickhouse,
  params: {
    organizationId: string;
    projectName: string;
    logName: string;
    runIds: number[];
  },
): Promise<Map<number, number>> {
  const { organizationId, projectName, logName, runIds } = params;
  if (runIds.length === 0) {
    return new Map();
  }

  const result = await ch.query(
    `
    SELECT runId, argMax(value, step) AS final_value
    FROM mlop_metrics
    WHERE tenantId = {tenantId: String}
      AND projectName = {projectName: String}
      AND logName = {logName: String}
      AND runId IN ({runIds: Array(UInt64)})
    GROUP BY runId
    `,
    { tenantId: organizationId, projectName, logName, runIds },
  );

  // ClickHouse serializes UInt64 as a string to avoid precision loss.
  const rows = (await result.json()) as { runId: string; final_value: number }[];
  return new Map(rows.map((row) => [Number(row.runId), row.final_value]));
}
