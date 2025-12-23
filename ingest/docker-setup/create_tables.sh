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

echo "Looking for SQL files in $SQL_DIR..."

# Find and process each .sql file
# Use print0 and read -d to handle filenames with spaces or special characters
find "$SQL_DIR" -maxdepth 1 -name "*.sql" -print0 | while IFS= read -r -d $'\0' sql_file; do
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