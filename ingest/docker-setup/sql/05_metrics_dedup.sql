-- Dedup raw-metrics table.
--
-- ReplacingMergeTree(time) keyed on (run, metric, step). When the same
-- (run, metric, step) is written multiple times — resume, eval rerun,
-- manual correction, double-flush — background merges collapse them to
-- the row with the highest `time`. Reads use FINAL to dedup before
-- merges complete.
--
-- Fed by 06_metrics_dedup_mv.sql, which mirrors every insert on
-- mlop_metrics into this table. Backfill of historical data is done
-- once at deploy time via ingest/scripts/migrate-refresh-mv.sh.
--
-- Chart queries and the refreshable summaries MV both read from this
-- table (with FINAL) so dedup is enforced at the engine level rather
-- than per-query argMax.
CREATE TABLE IF NOT EXISTS mlop_metrics_v2 (
    tenantId    LowCardinality(String) CODEC(ZSTD(1)),
    projectName String                 CODEC(ZSTD(1)),
    runId       UInt64                 CODEC(ZSTD(1)),
    logGroup    String                 CODEC(ZSTD(1)),
    logName     String                 CODEC(ZSTD(1)),
    time        DateTime64(3)          CODEC(DoubleDelta, LZ4),
    step        UInt64                 CODEC(DoubleDelta, LZ4),
    value       Float64                CODEC(ZSTD(1))
) ENGINE = ReplacingMergeTree(time)
ORDER BY (tenantId, projectName, runId, logGroup, logName, step)
