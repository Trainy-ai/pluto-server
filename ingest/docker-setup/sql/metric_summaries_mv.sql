-- Materialized view that pre-aggregates metric summaries.
-- Non-finite values (NaN/Inf/-Inf) are excluded via WHERE isFinite(value)
-- so they don't corrupt aggregate statistics.
--
-- NOTE (prod): For existing deployments, update the MV using:
--   DROP MATERIALIZED VIEW IF EXISTS mlop_metric_summaries_mv;
--   then re-run this CREATE statement.
-- (CREATE OR REPLACE is not supported for MVs with TO clause in CH <24.8)

CREATE MATERIALIZED VIEW IF NOT EXISTS mlop_metric_summaries_mv
TO mlop_metric_summaries
AS SELECT
    tenantId,
    projectName,
    runId,
    logName,
    min(value)              AS min_value,
    max(value)              AS max_value,
    sum(value)              AS sum_value,
    toUInt64(count())       AS count_value,
    argMaxState(value, step) AS last_value,
    sum(value * value)      AS sum_sq_value
FROM mlop_metrics
WHERE isFinite(value)
GROUP BY tenantId, projectName, runId, logName
