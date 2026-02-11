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
GROUP BY tenantId, projectName, runId, logName
