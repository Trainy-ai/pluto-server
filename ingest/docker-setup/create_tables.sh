#!/bin/bash

# Read environment variables or use defaults
CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://clickhouse:8123/}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-nope}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-nope}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-10}" # Timeout in seconds

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
SQL_DIR="$SCRIPT_DIR/sql"

# Check if sql directory exists
if [ ! -d "$SQL_DIR" ]; then
    echo "Error: SQL directory not found at $SQL_DIR"
    exit 1
fi

echo "Waiting for ClickHouse to be ready..."
MAX_RETRIES=30
RETRY_INTERVAL=2
for i in $(seq 1 $MAX_RETRIES); do
    if curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --connect-timeout 3 --max-time 5 \
        -d "SELECT 1" "$CLICKHOUSE_URL" > /dev/null 2>&1; then
        echo "ClickHouse is ready."
        break
    fi
    if [ "$i" -eq "$MAX_RETRIES" ]; then
        echo "Error: ClickHouse did not become ready after $MAX_RETRIES attempts."
        exit 1
    fi
    echo "ClickHouse not ready yet (attempt $i/$MAX_RETRIES), retrying in ${RETRY_INTERVAL}s..."
    sleep "$RETRY_INTERVAL"
done

echo "Looking for SQL files in $SQL_DIR..."

# Find and process each .sql file
# Use print0 and read -d to handle filenames with spaces or special characters
find "$SQL_DIR" -maxdepth 1 -name "*.sql" -print0 | sort -z | while IFS= read -r -d $'\0' sql_file; do
    filename=$(basename "$sql_file")
    echo "Processing $filename..."

    response_body_file=$(mktemp)
    # Ensure cleanup happens even on script exit/interrupt
    trap 'rm -f "$response_body_file"' EXIT INT TERM HUP

    http_status=$(curl -sS \
        -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --data-binary "@$sql_file" \
        -w "%{http_code}" \
        --connect-timeout "$REQUEST_TIMEOUT" \
        --max-time "$REQUEST_TIMEOUT" \
        -o "$response_body_file" \
        "$CLICKHOUSE_URL")

    curl_exit_code=$?

    if [ "$http_status" -eq 200 ]; then
        echo "Successfully executed $filename"
    else
        # ClickHouse returned an HTTP error status
        # Check if the error message contains "already exists"
        if grep -q "already exists" "$response_body_file"; then
             echo "Skipping $filename as it already exists (HTTP Status: $http_status)"
        else
             echo "Error executing $filename (HTTP Status: $http_status):"
             cat "$response_body_file" # Print the full error from ClickHouse
        fi
    fi
    # Clean up the temp file for this iteration
    rm -f "$response_body_file"
    # Reset trap for the next iteration or final exit
    trap - EXIT INT TERM HUP

done

echo "Finished processing SQL files."

# ── Idempotent column migrations for existing deployments ──
#
# `CREATE TABLE IF NOT EXISTS` in files.sql adds the `caption` column on a
# fresh DB, but existing deployments (persisted ClickHouse volume) created
# mlop_files before the column existed. `ADD COLUMN IF NOT EXISTS` backfills
# it and is a no-op once present, so it's safe on every startup. Run here as
# a separate statement because the ClickHouse HTTP interface rejects
# multi-statement SQL files.
echo "Ensuring mlop_files.caption column exists..."
caption_status=$(curl -sS \
    -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
    -w "%{http_code}" -o /dev/null \
    --connect-timeout "$REQUEST_TIMEOUT" --max-time "$REQUEST_TIMEOUT" \
    -d "ALTER TABLE mlop_files ADD COLUMN IF NOT EXISTS caption Nullable(String) CODEC(ZSTD(1))" \
    "$CLICKHOUSE_URL")
if [ "$caption_status" = "200" ]; then
    echo "mlop_files.caption column OK"
else
    echo "Warning: failed to ensure mlop_files.caption column (HTTP ${caption_status})"
fi

# ── Backfill mlop_metrics_v2 + force first v2 summaries refresh ──
#
# On a fresh container with pre-existing mlop_metrics data (e.g. a dev
# stack with a persisted ClickHouse volume), the mirror MV
# (mlop_metrics_v2_mv) only sees future inserts — historical rows never
# land in mlop_metrics_v2, and the refresh MV reading from v2 produces
# empty summaries. New chart code reads mlop_metric_summaries_v2, so the
# UI would show empty charts.
#
# Fix: backfill v2 from mlop_metrics, then trigger an immediate refresh
# of mlop_metric_summaries_v2_refresh_mv. Both are idempotent — re-runs
# on already-mirrored data are no-ops because ReplacingMergeTree
# collapses identical (run, metric, step, time) duplicates.
#
# The v1 mlop_metric_summaries table is left alone. Its incremental MV
# (sql/03_*) catches future inserts; historical-row backfill isn't done
# here because no production read path queries v1 anymore.
echo "Checking if mlop_metrics_v2 needs backfill..."

v2_metrics_count=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
    --connect-timeout "$REQUEST_TIMEOUT" --max-time 30 \
    -d "SELECT count() FROM mlop_metrics_v2" "$CLICKHOUSE_URL" 2>/dev/null | tr -d '[:space:]')

metrics_count=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
    --connect-timeout "$REQUEST_TIMEOUT" --max-time 30 \
    -d "SELECT count() FROM mlop_metrics" "$CLICKHOUSE_URL" 2>/dev/null | tr -d '[:space:]')

if [ "${v2_metrics_count:-0}" = "0" ] && [ "${metrics_count:-0}" != "0" ] && [ "${metrics_count:-0}" -gt 0 ] 2>/dev/null; then
    echo "Backfilling mlop_metrics_v2 from mlop_metrics (${metrics_count} rows)..."
    backfill_start=$(date +%s)

    backfill_response=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --connect-timeout "$REQUEST_TIMEOUT" --max-time 600 \
        -w "\n%{http_code}" \
        -d "INSERT INTO mlop_metrics_v2
            SELECT tenantId, projectName, runId, logGroup, logName, time, step, value
            FROM mlop_metrics" \
        "$CLICKHOUSE_URL")

    backfill_status=$(echo "$backfill_response" | tail -n1)
    backfill_end=$(date +%s)
    backfill_elapsed=$((backfill_end - backfill_start))

    if [ "$backfill_status" = "200" ]; then
        new_v2_count=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
            --connect-timeout "$REQUEST_TIMEOUT" --max-time 30 \
            -d "SELECT count() FROM mlop_metrics_v2" "$CLICKHOUSE_URL" 2>/dev/null | tr -d '[:space:]')
        echo "mlop_metrics_v2 backfill complete: ${new_v2_count} rows in ${backfill_elapsed}s"
    else
        echo "Error backfilling mlop_metrics_v2 (HTTP ${backfill_status}):"
        echo "$backfill_response" | head -n -1
    fi
else
    echo "mlop_metrics_v2 OK (${v2_metrics_count:-0} rows, mlop_metrics: ${metrics_count:-0} rows)"
fi

# Trigger one immediate refresh of the v2 summaries MV so the leaderboard
# is populated before the first scheduled tick (up to 5 min away).
v2_summaries_count=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
    --connect-timeout "$REQUEST_TIMEOUT" --max-time 30 \
    -d "SELECT count() FROM mlop_metric_summaries_v2" "$CLICKHOUSE_URL" 2>/dev/null | tr -d '[:space:]')

if [ "${v2_summaries_count:-0}" = "0" ] && [ "${metrics_count:-0}" != "0" ]; then
    echo "Triggering initial refresh of mlop_metric_summaries_v2_refresh_mv..."
    curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --connect-timeout "$REQUEST_TIMEOUT" --max-time 30 \
        -d "SYSTEM REFRESH VIEW mlop_metric_summaries_v2_refresh_mv" \
        "$CLICKHOUSE_URL" > /dev/null
    echo "   (refresh runs async; summaries will populate within seconds)"
fi
