#!/bin/bash
#
# One-time migration to stand up the v2 dedup pipeline:
#
#   * mlop_metrics_v2 — ReplacingMergeTree(time) keyed on
#     (run, metric, step). Background merges collapse duplicates.
#   * mlop_metrics_v2_mv — thin mirror MV, mlop_metrics → mlop_metrics_v2.
#   * mlop_metric_summaries_v2 — ReplacingMergeTree(version_at_compute),
#     populated by the refreshable MV below.
#   * mlop_metric_summaries_v2_refresh_mv — refreshable MV, every 5 min,
#     reads mlop_metrics_v2 FINAL and APPENDs one row per (run, metric).
#
# THIS MIGRATION IS NON-DESTRUCTIVE. It creates new tables/MVs alongside
# the existing mlop_metric_summaries (AggregatingMergeTree) and its
# incremental mlop_metric_summaries_mv. Both keep running. Old code keeps
# reading the old table; new code reads the v2 table. The old table will
# be dropped in a follow-up cleanup PR once we're confident in v2.
#
# Cutover order (safe in either direction):
#   1. Run THIS script in staging/prod. v2 tables are created and the
#      refresh MV starts populating them. Existing reads are unaffected.
#   2. Spot-check mlop_metric_summaries_v2 against mlop_metric_summaries
#      for resumed runs to confirm dedup correctness.
#   3. Deploy backend with the new SQL files (so future fresh containers
#      also get the v2 schema on startup) and the new app code that reads
#      from mlop_metric_summaries_v2.
#   4. (Later cleanup PR) Drop mlop_metric_summaries +
#      mlop_metric_summaries_mv once production is fully on v2.
#
# Usage:
#   CLICKHOUSE_URL=http://clickhouse:8123 \
#   CLICKHOUSE_USER=... \
#   CLICKHOUSE_PASSWORD=... \
#     ./migrate-refresh-mv.sh

set -euo pipefail

CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://clickhouse:8123/}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-nope}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-nope}"

run_sql() {
    sql="$1"
    label="$2"
    echo ">> ${label}"
    response=$(mktemp)
    http_status=$(curl -sS \
        -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --max-time 7200 \
        --data-binary "$sql" \
        -w "%{http_code}" \
        -o "$response" \
        "$CLICKHOUSE_URL")
    if [ "$http_status" -ne 200 ]; then
        echo "ERROR (${http_status}):"
        cat "$response"
        rm -f "$response"
        exit 1
    fi
    rm -f "$response"
    echo "   ok"
}

# Submit a long-running statement asynchronously and poll until it leaves
# system.processes. Robust against TCP keepalive / proxy idle timeouts that
# would otherwise drop the curl connection while CH keeps running. After
# the query disappears from system.processes, we check system.query_log
# for QueryFinish vs ExceptionWhileProcessing.
run_sql_async() {
    sql="$1"
    label="$2"
    echo ">> ${label}"
    query_id="migrate-refresh-mv-$(date +%s)-$$-$RANDOM"

    # Submit. wait_end_of_query=0 should make CH return as soon as the query
    # is accepted rather than blocking until completion — but on heavy
    # statements (e.g. 5.7B-row INSERT) CH still doesn't ack within the
    # ~60s connection timeout. Treat curl timeout as "submission probably
    # succeeded, verify via system.processes" rather than failing.
    submit_response=$(mktemp)
    submit_status=$(curl -sS \
        -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --max-time 60 \
        --data-binary "$sql" \
        -w "%{http_code}" \
        -o "$submit_response" \
        "${CLICKHOUSE_URL}?query_id=${query_id}&wait_end_of_query=0" || true)
    rm -f "$submit_response"

    if [ "$submit_status" = "200" ]; then
        echo "   submitted (query_id=${query_id})"
    else
        # curl error or non-200: maybe CH still accepted the query. Check
        # system.processes before giving up.
        sleep 2
        in_flight=$(curl -sS \
            -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
            --max-time 30 \
            --data-binary "SELECT count() FROM system.processes WHERE query_id = '${query_id}'" \
            "$CLICKHOUSE_URL" | tr -d '[:space:]')
        if [ "${in_flight:-0}" = "0" ]; then
            echo "ERROR submitting (status=${submit_status:-timeout}, no in-flight query):"
            exit 1
        fi
        echo "   submitted (query_id=${query_id}, ack timed out but query is running)"
    fi

    # Poll system.processes until the query is gone.
    poll_start=$(date +%s)
    while true; do
        running=$(curl -sS \
            -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
            --max-time 30 \
            --data-binary "SELECT count() FROM system.processes WHERE query_id = '${query_id}'" \
            "$CLICKHOUSE_URL" | tr -d '[:space:]')
        if [ "${running:-0}" = "0" ]; then
            break
        fi
        elapsed=$(( $(date +%s) - poll_start ))
        echo "   still running after ${elapsed}s..."
        sleep 30
    done

    # Check system.query_log for terminal status. Most recent row wins; CH
    # writes both QueryStart and QueryFinish/ExceptionWhileProcessing rows
    # for a given query_id.
    sleep 2  # let query_log catch up
    final_status=$(curl -sS \
        -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --max-time 30 \
        --data-binary "SELECT type FROM system.query_log WHERE query_id = '${query_id}' AND type IN ('QueryFinish', 'ExceptionWhileProcessing') ORDER BY event_time DESC LIMIT 1" \
        "$CLICKHOUSE_URL" | tr -d '[:space:]')
    if [ "$final_status" = "QueryFinish" ]; then
        echo "   ok"
    else
        echo "ERROR — final status: ${final_status:-unknown}"
        echo "Inspect: SELECT * FROM system.query_log WHERE query_id = '${query_id}' FORMAT Vertical"
        exit 1
    fi
}

echo "== mlop_metric_summaries_v2 migration (non-destructive) =="
echo "   target: $CLICKHOUSE_URL"
echo

# Step 1: ensure mlop_metrics_v2 + mirror MV exist (safety net — should
# already exist from sql/05_metrics_dedup.sql + 06_metrics_dedup_mv.sql
# on container startup).
run_sql \
    "CREATE TABLE IF NOT EXISTS mlop_metrics_v2 (
         tenantId    LowCardinality(String) CODEC(ZSTD(1)),
         projectName String                 CODEC(ZSTD(1)),
         runId       UInt64                 CODEC(ZSTD(1)),
         logGroup    String                 CODEC(ZSTD(1)),
         logName     String                 CODEC(ZSTD(1)),
         time        DateTime64(3)          CODEC(DoubleDelta, LZ4),
         step        UInt64                 CODEC(DoubleDelta, LZ4),
         value       Float64                CODEC(ZSTD(1))
     ) ENGINE = ReplacingMergeTree(time)
     ORDER BY (tenantId, projectName, runId, logGroup, logName, step)" \
    "step 1a — ensure mlop_metrics_v2 exists"

run_sql \
    "CREATE MATERIALIZED VIEW IF NOT EXISTS mlop_metrics_v2_mv
     TO mlop_metrics_v2
     AS SELECT
         tenantId, projectName, runId, logGroup, logName, time, step, value
     FROM mlop_metrics" \
    "step 1b — ensure mirror MV exists"

# Step 2: backfill mlop_metrics_v2 from existing mlop_metrics. The
# mirror MV only sees inserts after it was created; this picks up
# everything that was written before. Idempotent — ReplacingMergeTree
# collapses duplicates (re-inserted rows have the same time, so the
# merge is a no-op on data already mirrored).
#
# At our scale this is ~5.7B rows — expect 10–30 min on the small CH
# cluster. Run during a low-traffic window. Submitted async via
# run_sql_async so the script doesn't depend on a single HTTP connection
# staying alive for the whole backfill.
run_sql_async \
    "INSERT INTO mlop_metrics_v2
     SELECT tenantId, projectName, runId, logGroup, logName, time, step, value
     FROM mlop_metrics" \
    "step 2 — backfill mlop_metrics_v2 from mlop_metrics (this may take a while)"

# Step 3: force background merges immediately so dedup is done up
# front. Without this, merges happen in the background over several
# minutes/hours and duplicates are visible to non-FINAL queries until
# then. Reads use FINAL anyway so this isn't strictly required for
# correctness, but compaction is nice to have. Async for the same reason
# as step 2 — OPTIMIZE FINAL on a freshly-backfilled v2 can take a while.
run_sql_async \
    "OPTIMIZE TABLE mlop_metrics_v2 FINAL" \
    "step 3 — OPTIMIZE FINAL on mlop_metrics_v2 (compact duplicates)"

# Step 4: create the v2 summary table. Side-by-side with the existing
# mlop_metric_summaries, which keeps being fed by the broken incremental
# mlop_metric_summaries_mv — old code reads it; new code reads v2.
run_sql \
    "CREATE TABLE IF NOT EXISTS mlop_metric_summaries_v2 (
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
         min_step            UInt64,
         max_step            UInt64,
         argmin_step         AggregateFunction(argMin, UInt64, Float64),
         argmax_step         AggregateFunction(argMax, UInt64, Float64),
         version_at_compute  UInt64
     ) ENGINE = ReplacingMergeTree(version_at_compute)
     ORDER BY (tenantId, projectName, logName, runId)" \
    "step 4 — create mlop_metric_summaries_v2"

# Step 5: install the refreshable MV. Mirrors what
# 07_metric_summaries_v2_refresh_mv.sql would create on a fresh container
# startup, but explicit here for clusters that haven't picked up the new
# file yet.
run_sql \
    "CREATE MATERIALIZED VIEW IF NOT EXISTS mlop_metric_summaries_v2_refresh_mv
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
         argMinStateIf(step, value, isFinite(value))            AS argmin_step,
         argMaxStateIf(step, value, isFinite(value))            AS argmax_step,
         toUInt64(toUnixTimestamp64Milli(now64(3)))             AS version_at_compute
     FROM mlop_metrics_v2 FINAL
     GROUP BY tenantId, projectName, runId, logName" \
    "step 5 — create refreshable MV (mlop_metric_summaries_v2_refresh_mv)"

# Step 6: trigger one immediate refresh so summaries are populated
# before users notice. Without this, the table is empty until the first
# scheduled cycle (up to 5 min away). SYSTEM REFRESH returns immediately
# but the refresh itself runs async in CH; we poll system.view_refreshes
# until its status leaves "Running" so the script doesn't claim
# "migration complete" until the table is actually populated.
run_sql \
    "SYSTEM REFRESH VIEW mlop_metric_summaries_v2_refresh_mv" \
    "step 6a — trigger first refresh"

echo ">> step 6b — wait for first refresh to complete"
poll_start=$(date +%s)
while true; do
    status=$(curl -sS \
        -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --max-time 30 \
        --data-binary "SELECT status FROM system.view_refreshes WHERE view = 'mlop_metric_summaries_v2_refresh_mv'" \
        "$CLICKHOUSE_URL" | tr -d '[:space:]')
    if [ "$status" != "Running" ] && [ -n "$status" ]; then
        echo "   refresh status: $status (took $(( $(date +%s) - poll_start ))s)"
        break
    fi
    elapsed=$(( $(date +%s) - poll_start ))
    echo "   still refreshing after ${elapsed}s..."
    sleep 30
done

echo
echo "== migration complete (non-destructive) =="
echo
echo "What's running now:"
echo "  - mlop_metric_summaries (legacy, AggregatingMergeTree) — still"
echo "    fed by mlop_metric_summaries_mv; old code reads it."
echo "  - mlop_metric_summaries_v2 (new, ReplacingMergeTree) — fed every"
echo "    5 min by mlop_metric_summaries_v2_refresh_mv; new code reads it."
echo
echo "Next steps:"
echo "  1. Spot-check resumed runs against mlop_metric_summaries_v2 to"
echo "     confirm leaderboard reflects last-write-wins values."
echo "  2. Deploy the new app code (reads mlop_metric_summaries_v2)."
echo "     Rollback path: redeploy old code; v1 table is still up to date."
echo "  3. (Follow-up PR) Once production has run on v2 long enough to"
echo "     trust it, drop the legacy v1 plumbing:"
echo "       DROP VIEW mlop_metric_summaries_mv;"
echo "       DROP TABLE mlop_metric_summaries;"
