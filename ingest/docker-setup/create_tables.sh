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

# ── Backfill metric summaries if the MV missed historical inserts ──
echo "Checking if metric summaries need backfill..."

summaries_count=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
    --connect-timeout "$REQUEST_TIMEOUT" --max-time 30 \
    -d "SELECT count() FROM mlop_metric_summaries" "$CLICKHOUSE_URL" 2>/dev/null | tr -d '[:space:]')

metrics_count=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
    --connect-timeout "$REQUEST_TIMEOUT" --max-time 30 \
    -d "SELECT count() FROM mlop_metrics" "$CLICKHOUSE_URL" 2>/dev/null | tr -d '[:space:]')

if [ "${summaries_count:-0}" = "0" ] && [ "${metrics_count:-0}" != "0" ] && [ "${metrics_count:-0}" -gt 0 ] 2>/dev/null; then
    echo "Backfilling metric summaries (mlop_metrics has ${metrics_count} rows, summaries has 0)..."
    backfill_start=$(date +%s)

    backfill_response=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
        --connect-timeout "$REQUEST_TIMEOUT" --max-time 600 \
        -w "\n%{http_code}" \
        -d "INSERT INTO mlop_metric_summaries
            SELECT tenantId, projectName, runId, logName,
                min(value), max(value), sum(value),
                toUInt64(count()),
                argMaxState(value, step),
                sum(value * value)
            FROM mlop_metrics
            WHERE isFinite(value)
            GROUP BY tenantId, projectName, runId, logName" \
        "$CLICKHOUSE_URL")

    backfill_status=$(echo "$backfill_response" | tail -n1)
    backfill_end=$(date +%s)
    backfill_elapsed=$((backfill_end - backfill_start))

    if [ "$backfill_status" -eq 200 ]; then
        new_summaries=$(curl -sS -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
            --connect-timeout "$REQUEST_TIMEOUT" --max-time 30 \
            -d "SELECT count() FROM mlop_metric_summaries" "$CLICKHOUSE_URL" 2>/dev/null | tr -d '[:space:]')
        echo "Metric summaries backfill complete: ${new_summaries} rows in ${backfill_elapsed}s"
    else
        echo "Error backfilling metric summaries (HTTP ${backfill_status}):"
        echo "$backfill_response" | head -n -1
    fi
else
    echo "Metric summaries OK (${summaries_count:-0} rows, metrics: ${metrics_count:-0} rows)"
fi 