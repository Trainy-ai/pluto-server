-- Mirror MV: every insert on mlop_metrics also lands in mlop_metrics_v2.
-- Thin SELECT — no aggregation, no filtering. The dedup happens in the
-- target table's ReplacingMergeTree engine via background merges.
--
-- Ingest writers don't need to know about v2; they keep writing to
-- mlop_metrics. Historical mlop_metrics rows are backfilled once via
-- ingest/scripts/migrate-refresh-mv.sh.
CREATE MATERIALIZED VIEW IF NOT EXISTS mlop_metrics_v2_mv
TO mlop_metrics_v2
AS SELECT
    tenantId, projectName, runId, logGroup, logName, time, step, value
FROM mlop_metrics
