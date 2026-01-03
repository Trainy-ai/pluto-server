# Load Testing for mlop Ingestion Pipeline

This directory contains end-to-end load tests for the complete mlop stack.

## Overview

The load tests simulate real-world usage patterns by:
- Testing the **complete stack**: Backend API → Rust Ingest → ClickHouse
- Authenticating via API keys (backend validates against PostgreSQL)
- Simulating multiple concurrent users training ML models
- Logging metrics with realistic patterns (train/val losses, accuracies, etc.)
- Measuring end-to-end latency from HTTP request to ClickHouse storage

## Architecture

```
Locust → HTTP Requests → Backend API (Auth) → Rust Ingest Service → ClickHouse
           └─ Authorization: Bearer <API_KEY>        │
                                                      ├─→ 3-Layer Buffering
                                                      ├─→ Background Processors
                                                      ├─→ Dead-Letter Queue (DLQ)
                                                      └─→ MinIO (file storage)

  └─ Tracks: p50, p95, p99 latency, error rate, throughput, DLQ stats
```

## Two Test Approaches

We run **both** HTTP and SDK-based tests for comprehensive coverage:

1. **HTTP Test** (`locustfile_http.py`) - Direct endpoint testing, 100 users
2. **SDK Test** (`locustfile.py`) - Real SDK flow including buffering/sync, 50 users

See [SDK_VS_HTTP.md](SDK_VS_HTTP.md) for detailed comparison and how each test works.

## Running Locally

### Prerequisites

1. Start the load test infrastructure:
```bash
cd /path/to/server-private
docker compose -f .buildkite/docker-compose.loadtest.yml up -d --wait
```

2. Set up test fixtures (user, organization, API key, project):
```bash
docker compose -f .buildkite/docker-compose.loadtest.yml run --rm setup
```

This will output the generated API key. Look for the line:
```
TEST_API_KEY=mlps_loadtest_deterministic_key_for_ci_load_tests_12345678
```

3. Export the API key:
```bash
export TEST_API_KEY=mlps_loadtest_deterministic_key_for_ci_load_tests_12345678
```

### Run Load Test

Build and run the load test:

```bash
# Build the load test image
docker build -t mlop-loadtest:latest ./load_tests

# Run the load test (5 minutes, 100 users)
docker run --rm --network buildkite_default \
  -v "$PWD/load_tests/reports:/mnt/locust/reports" \
  -e INGEST_URL=http://ingest:3003 \
  -e TEST_API_KEY="$TEST_API_KEY" \
  -e P95_THRESHOLD_MS=500 \
  -e P99_THRESHOLD_MS=1000 \
  -e MAX_ERROR_RATE=0.01 \
  mlop-loadtest:latest \
  -f /mnt/locust/locustfile.py \
  --headless \
  --users 100 \
  --spawn-rate 10 \
  --run-time 300s \
  --html /mnt/locust/reports/report.html \
  --csv /mnt/locust/reports/results

# Or for a quick test (30 seconds, 10 users):
docker run --rm --network buildkite_default \
  -v "$PWD/load_tests/reports:/mnt/locust/reports" \
  -e INGEST_URL=http://ingest:3003 \
  -e TEST_API_KEY="$TEST_API_KEY" \
  mlop-loadtest:latest \
  -f /mnt/locust/locustfile.py \
  --headless \
  --users 10 \
  --spawn-rate 2 \
  --run-time 30s \
  --html /mnt/locust/reports/report.html
```

### View Results

- HTML Report: `load_tests/reports/report.html`
- CSV Results: `load_tests/reports/results_*.csv`
- JSON Summary: `load_tests/reports/latest.json`

### Cleanup

After running tests, clean up test runs (keeps organization and API key for next run):

```bash
docker compose -f .buildkite/docker-compose.loadtest.yml run --rm setup pnpm exec tsx tests/setup.ts cleanup
```

To completely tear down infrastructure:

```bash
docker compose -f .buildkite/docker-compose.loadtest.yml down -v
```

## Configuration

Environment variables:

- `INGEST_URL`: Ingest service URL (default: `http://localhost:3003`)
- `TEST_API_KEY`: API key for authentication
- `P95_THRESHOLD_MS`: P95 latency threshold in ms (default: 500)
- `P99_THRESHOLD_MS`: P99 latency threshold in ms (default: 1000)
- `MAX_ERROR_RATE`: Maximum error rate (default: 0.01 = 1%)

## Test Scenarios

### 1. Metrics Logging (50% of traffic)
Simulates typical training loop:
- Logs 5-6 metrics per step (train/val losses, accuracies, learning rate)
- Uses `run.log()` SDK method
- Most common operation in real usage

### 2. Explicit Step Logging (30% of traffic)
Advanced usage pattern:
- Logs metrics with explicit step and timestamp
- Uses `run._log()` internal API
- Tests internal SDK behavior

## Performance Thresholds

Tests fail if:
- P95 latency > 500ms
- P99 latency > 1000ms
- Error rate > 1%

## Baseline Comparison

Create a baseline from successful run:

```bash
cp load_tests/reports/latest.json load_tests/baseline/baseline_results.json
```

Future runs will compare against this baseline:
- Alert if p95/p99 increases > 20%
- Alert if error rate increases > 5%

## CI Integration

The load test runs automatically in Buildkite CI:
- Runs on every push to main
- Creates fresh infrastructure (PostgreSQL, ClickHouse, MinIO, Ingest)
- 20-minute timeout
- Uploads HTML report as artifact

## Troubleshooting

### SDK fails to initialize
- Check API key is valid
- Verify ingest service is running and healthy
- Check network connectivity between Locust container and ingest service

### High error rates
- Check ClickHouse health: `docker compose exec clickhouse clickhouse-client --query "SELECT 1"`
- Check DLQ stats: `curl http://localhost:3003/health/dlq`
- View ingest logs: `docker compose logs ingest`

### Low throughput
- Increase `--users` and `--spawn-rate` parameters
- Check if ClickHouse is the bottleneck
- Monitor system resources (CPU, memory, disk I/O)
