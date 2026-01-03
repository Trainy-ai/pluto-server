"""
Load test for mlop ingestion pipeline using HTTP requests

This tests the actual HTTP endpoints that the SDK calls under the hood.
Tests end-to-end performance: HTTP → Rust Ingest → ClickHouse
"""

import json
import random
import time

from locust import HttpUser, between, events, task

from config import config


class IngestHTTPUser(HttpUser):
    """Load test user that directly calls ingestion HTTP endpoints"""

    host = config.ingest_url
    wait_time = between(0.1, 0.5)

    def on_start(self):
        """Setup for each simulated user"""
        self.step = 0
        self.run_id = str(int(time.time() * 1000) + id(self) % 1000000)

        # Headers for all requests
        self.headers = {
            "Authorization": f"Bearer {config.api_key}",
            "X-Run-Id": self.run_id,  # Required header
            "X-Project-Name": "load-test-project",  # Required header
            "Content-Type": "application/json",
        }

    @task(5)  # 50% of traffic
    def post_metrics(self):
        """Post metrics batch (most common operation)"""
        self.step += 1

        # NDJSON format: one JSON object per line
        metric_record = {
            "time": int(time.time() * 1000),  # Unix timestamp in milliseconds
            "step": self.step,
            "data": {
                "train/loss": random.uniform(0, 1),
                "train/accuracy": random.uniform(0.8, 1.0),
                "val/loss": random.uniform(0, 1),
                "val/accuracy": random.uniform(0.75, 0.95),
                "learning_rate": random.uniform(0.0001, 0.001),
            },
        }

        # Send as newline-delimited JSON (NDJSON)
        ndjson_data = json.dumps(metric_record) + "\n"

        with self.client.post(
            "/ingest/metrics",
            data=ndjson_data,
            headers={**self.headers, "Content-Type": "application/x-ndjson"},
            catch_response=True,
            name="POST /ingest/metrics",
        ) as response:
            if response.status_code not in [200, 201, 202]:
                response.failure(f"Got status {response.status_code}: {response.text}")

    @task(3)  # 30% of traffic
    def post_console_logs(self):
        """Post console output logs"""
        log_record = {
            "time": int(time.time() * 1000),
            "message": f"Training step {self.step} completed - batch_size: {random.randint(16, 128)}",
            "lineNumber": self.step,
            "logType": "stdout",
        }

        ndjson_data = json.dumps(log_record) + "\n"

        with self.client.post(
            "/ingest/logs",  # Correct endpoint name
            data=ndjson_data,
            headers={**self.headers, "Content-Type": "application/x-ndjson"},
            catch_response=True,
            name="POST /ingest/logs",
        ) as response:
            if response.status_code not in [200, 201, 202]:
                response.failure(f"Got status {response.status_code}: {response.text}")

    @task(2)  # 20% of traffic
    def post_custom_data(self):
        """Post custom data structures"""
        data_payload = {
            "batch_loss": random.uniform(0, 1.5),
            "batch_size": random.randint(16, 128),
            "gpu_util": random.uniform(0.7, 1.0),
        }

        data_record = {
            "time": int(time.time() * 1000),
            "step": self.step,
            "data": json.dumps(data_payload),  # Serialize data as string
            "dataType": "batch_metrics",
            "logName": "training_metrics",
        }

        ndjson_data = json.dumps(data_record) + "\n"

        with self.client.post(
            "/ingest/data",
            data=ndjson_data,
            headers={**self.headers, "Content-Type": "application/x-ndjson"},
            catch_response=True,
            name="POST /ingest/data",
        ) as response:
            if response.status_code not in [200, 201, 202]:
                response.failure(f"Got status {response.status_code}: {response.text}")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Validate performance thresholds and fail CI if exceeded"""
    stats = environment.stats.total

    p50 = stats.get_response_time_percentile(0.5)
    p95 = stats.get_response_time_percentile(0.95)
    p99 = stats.get_response_time_percentile(0.99)
    error_rate = stats.fail_ratio

    print(f"\n{'='*60}")
    print(f"LOAD TEST RESULTS")
    print(f"{'='*60}")
    print(f"Total Requests:  {stats.num_requests:,}")
    print(f"Failed Requests: {stats.num_failures:,}")
    print(f"RPS:             {stats.total_rps:.2f}")
    print(f"P50 Latency:     {p50}ms")
    print(f"P95 Latency:     {p95}ms")
    print(f"P99 Latency:     {p99}ms")
    print(f"Error Rate:      {error_rate*100:.2f}%")
    print(f"{'='*60}\n")

    # Save results for baseline comparison
    results = {
        "p50_ms": p50,
        "p95_ms": p95,
        "p99_ms": p99,
        "error_rate": error_rate,
        "total_requests": stats.num_requests,
        "rps": stats.total_rps if hasattr(stats, "total_rps") else 0,
    }

    with open("/mnt/locust/reports/latest.json", "w") as f:
        json.dump(results, f, indent=2)

    # Check thresholds (fail CI if exceeded)
    passed = True

    if p95 > config.p95_threshold_ms:
        print(f"❌ FAILED: p95 {p95}ms exceeds {config.p95_threshold_ms}ms")
        environment.process_exit_code = 1
        passed = False

    if p99 > config.p99_threshold_ms:
        print(f"❌ FAILED: p99 {p99}ms exceeds {config.p99_threshold_ms}ms")
        environment.process_exit_code = 1
        passed = False

    if error_rate > config.max_error_rate:
        print(f"❌ FAILED: Error rate {error_rate*100:.2f}% exceeds {config.max_error_rate*100}%")
        environment.process_exit_code = 1
        passed = False

    if passed:
        print("✅ All performance thresholds passed!")
