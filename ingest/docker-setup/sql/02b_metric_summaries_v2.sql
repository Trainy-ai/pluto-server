-- v2 of mlop_metric_summaries: dedup-correct rewrite of the leaderboard
-- summary table. Lives alongside the original mlop_metric_summaries (which
-- the broken incremental MV at 03_metric_summaries_mv.sql still feeds) so
-- the migration can roll out safely:
--
--   * deploy migration → v2 table is created, refresh MV starts populating
--     it; nothing reads from v2 yet, old code is unaffected.
--   * deploy new app code → reads switch to v2; old table still up to date
--     (incrementally) so we can revert by redeploying old code.
--   * later cleanup PR → drop mlop_metric_summaries +
--     mlop_metric_summaries_mv once we're confident in v2.
--
-- Engine choice and APPEND-only writes:
--
-- ReplacingMergeTree(version_at_compute). Each refresh of
-- mlop_metric_summaries_v2_refresh_mv (07_*) appends one row per
-- (run, metric) with version = now(). Background merges collapse duplicates
-- by keeping the row with the highest version. Reads use FINAL (or
-- argMaxBy version) to dedup at query time before merges complete.
--
-- APPEND beats ALTER TABLE DELETE because:
--   * DELETE is a CH "mutation" — heavier than INSERT, with metadata +
--     replication overhead.
--   * APPEND eliminates the brief "no row" race window between a DELETE
--     and the follow-up INSERT — ReplacingMergeTree keeps the old row
--     visible until merges drop it.
--
-- The aggregate-function columns (last_value, argmin_step, argmax_step)
-- still store CH aggregate states; readers extract the final value with
-- argMaxMerge / argMinMerge. With ReplacingMergeTree + FINAL each
-- (run, metric) returns one row, so the merge functions effectively
-- just unwrap the state — no cross-row combining.
--
-- The aggregates are computed against mlop_metrics_v2 FINAL inside the
-- refresh MV (see 07_*). FINAL there collapses raw (run, metric, step)
-- duplicates by latest `time`, which is what fixes the doubled-count /
-- latched-min-max behavior the old incremental MV produced on resumed
-- runs.
CREATE TABLE IF NOT EXISTS mlop_metric_summaries_v2 (
    tenantId            LowCardinality(String) CODEC(ZSTD(1)),
    projectName         String                 CODEC(ZSTD(1)),
    runId               UInt64                 CODEC(ZSTD(1)),
    logName             String                 CODEC(ZSTD(1)),
    min_value           Float64,
    max_value           Float64,
    sum_value           Float64,
    count_value         UInt64,
    last_value          AggregateFunction(argMax, Float64, UInt64),
    sum_sq_value        Float64,
    -- min/max step for fast bucket-bounds lookup on initial chart loads.
    -- Lets queryRunMetricsMultiMetricBatchBucketed skip the expensive
    -- per-step "bounds" CTE on the raw mlop_metrics_v2 table.
    min_step            UInt64,
    max_step            UInt64,
    -- Step at which the metric reached its min / max value. Powers the
    -- "Pin to best step" fast path — without these, the only way to
    -- learn the argmin step was to scan raw mlop_metrics for the run.
    argmin_step         AggregateFunction(argMin, UInt64, Float64),
    argmax_step         AggregateFunction(argMax, UInt64, Float64),
    -- ReplacingMergeTree version column — highest-version row per primary
    -- key wins.
    version_at_compute  UInt64
) ENGINE = ReplacingMergeTree(version_at_compute)
ORDER BY (tenantId, projectName, logName, runId)
