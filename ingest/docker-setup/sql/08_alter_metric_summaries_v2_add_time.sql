-- Adds min_time / max_time columns to mlop_metric_summaries_v2 and
-- recreates the refresh MV to populate them.
--
-- Motivation: queryRunMetricsGroupedBatchBucketed needs per-(group,
-- logName) wall-clock bounds for the time and relative-time x-axes.
-- Without summary-stored time bounds, the query has to scan
-- mlop_metrics_v2 inline for min/max(time) — effectively doubling the
-- raw-table work vs the step-axis path, which gets its bounds from
-- this summary table for free.
--
-- Safe to run on a populated cluster:
--   * ALTER ADD COLUMN with a default is online — existing rows get
--     min_time = '1970-01-01 00:00:00.000', max_time = same. The next
--     MV refresh overwrites every row with real values.
--   * DROP MV + CREATE MV swaps the MV without touching the target
--     table. The 5-min refresh cadence resumes from the new definition.
--   * SYSTEM REFRESH VIEW forces an immediate one-off rebuild so the
--     new columns are populated for ALL existing summaries without
--     waiting up to 5 minutes.

ALTER TABLE mlop_metric_summaries_v2
    ADD COLUMN IF NOT EXISTS min_time DateTime64(3) DEFAULT toDateTime64(0, 3),
    ADD COLUMN IF NOT EXISTS max_time DateTime64(3) DEFAULT toDateTime64(0, 3);

DROP TABLE IF EXISTS mlop_metric_summaries_v2_refresh_mv;

CREATE MATERIALIZED VIEW IF NOT EXISTS mlop_metric_summaries_v2_refresh_mv
REFRESH EVERY 5 MINUTE
APPEND
TO mlop_metric_summaries_v2
AS SELECT
    tenantId,
    projectName,
    runId,
    logName,
    minIf(value, isFinite(value))                          AS min_value,
    maxIf(value, isFinite(value))                          AS max_value,
    sumIf(value, isFinite(value))                          AS sum_value,
    toUInt64(countIf(isFinite(value)))                     AS count_value,
    argMaxStateIf(value, step, isFinite(value))            AS last_value,
    sumIf(value * value, isFinite(value))                  AS sum_sq_value,
    min(step)                                              AS min_step,
    max(step)                                              AS max_step,
    min(time)                                              AS min_time,
    max(time)                                              AS max_time,
    argMinStateIf(step, value, isFinite(value))            AS argmin_step,
    argMaxStateIf(step, value, isFinite(value))            AS argmax_step,
    toUInt64(toUnixTimestamp64Milli(now64(3)))             AS version_at_compute
FROM mlop_metrics_v2 FINAL
GROUP BY tenantId, projectName, runId, logName;

-- Force an immediate refresh so the new columns are populated for ALL
-- existing summary rows. Without this, the columns stay at their
-- DEFAULT 1970-01-01 value until the next 5-minute tick.
SYSTEM REFRESH VIEW mlop_metric_summaries_v2_refresh_mv;
