"""
Stress Test for mlop Ingestion Pipeline

This test aggressively ramps up load to find the service limits.
Unlike the normal load tests, this is EXPECTED to cause failures
at high loads - the goal is to find where things break.

Results help with:
- Capacity planning
- Understanding bottlenecks
- Setting realistic SLA targets
- Infrastructure sizing
"""

import json
import random
import time

from locust import HttpUser, between, events, task

from config import config


class StressTestUser(HttpUser):
    """Aggressive load test user to find service limits"""

    host = config.ingest_url
    wait_time = between(0.01, 0.1)  # Very short wait time for high load

    def on_start(self):
        """Setup for each simulated user"""
        self.step = 0
        self.run_id = str(int(time.time() * 1000) + id(self) % 1000000)

        # Headers for all requests
        self.headers = {
            "Authorization": f"Bearer {config.api_key}",
            "X-Run-Id": self.run_id,
            "X-Project-Name": "load-test-project",
            "Content-Type": "application/json",
        }

    @task(10)  # Highest weight - metrics are most common
    def post_metrics(self):
        """Post metrics batch (most common operation)"""
        self.step += 1

        # NDJSON format with multiple records per request for higher throughput
        records = []
        for _ in range(5):  # Send 5 metrics per request
            metric_record = {
                "time": int(time.time() * 1000),
                "step": self.step,
                "data": {
                    "train/loss": random.uniform(0, 1),
                    "train/accuracy": random.uniform(0.8, 1.0),
                    "val/loss": random.uniform(0, 1),
                    "val/accuracy": random.uniform(0.75, 0.95),
                },
            }
            records.append(json.dumps(metric_record))

        ndjson_data = "\n".join(records) + "\n"

        with self.client.post(
            "/ingest/metrics",
            data=ndjson_data,
            headers={**self.headers, "Content-Type": "application/x-ndjson"},
            catch_response=True,
            name="POST /ingest/metrics (batch)",
        ) as response:
            if response.status_code not in [200, 201, 202]:
                response.failure(f"Status {response.status_code}")

    @task(3)
    def post_logs(self):
        """Post console logs"""
        log_record = {
            "time": int(time.time() * 1000),
            "message": f"Step {self.step} - batch_size: {random.randint(16, 128)}",
            "lineNumber": self.step,
            "logType": "stdout",
        }

        ndjson_data = json.dumps(log_record) + "\n"

        with self.client.post(
            "/ingest/logs",
            data=ndjson_data,
            headers={**self.headers, "Content-Type": "application/x-ndjson"},
            catch_response=True,
            name="POST /ingest/logs",
        ) as response:
            if response.status_code not in [200, 201, 202]:
                response.failure(f"Status {response.status_code}")

    @task(2)
    def post_data(self):
        """Post custom data"""
        data_payload = {
            "batch_loss": random.uniform(0, 1.5),
            "batch_size": random.randint(16, 128),
            "gpu_util": random.uniform(0.7, 1.0),
        }

        data_record = {
            "time": int(time.time() * 1000),
            "step": self.step,
            "data": json.dumps(data_payload),
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
                response.failure(f"Status {response.status_code}")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Analyze stress test results and report capacity limits"""
    stats = environment.stats.total

    p50 = stats.get_response_time_percentile(0.5)
    p95 = stats.get_response_time_percentile(0.95)
    p99 = stats.get_response_time_percentile(0.99)
    p999 = stats.get_response_time_percentile(0.999)
    error_rate = stats.fail_ratio

    print(f"\n{'='*70}")
    print(f"STRESS TEST RESULTS - FINDING SERVICE LIMITS")
    print(f"{'='*70}")
    print(f"Total Requests:  {stats.num_requests:,}")
    print(f"Failed Requests: {stats.num_failures:,} ({error_rate*100:.2f}%)")
    print(f"Successful:      {stats.num_requests - stats.num_failures:,}")
    print(f"")
    print(f"Throughput:")
    print(f"  RPS (avg):     {stats.total_rps:.2f} requests/sec")
    print(f"  Peak RPS:      {stats.max_requests:.2f} requests/sec" if hasattr(stats, 'max_requests') else "")
    print(f"")
    print(f"Latency Distribution:")
    print(f"  P50:           {p50}ms")
    print(f"  P95:           {p95}ms")
    print(f"  P99:           {p99}ms")
    print(f"  P99.9:         {p999}ms")
    print(f"  Max:           {stats.max_response_time}ms")
    print(f"{'='*70}")

    # Determine service capacity
    if error_rate < 0.01:
        print(f"✅ SERVICE HANDLED LOAD WELL")
        print(f"   - Error rate: {error_rate*100:.2f}% (< 1%)")
        print(f"   - Sustained: {stats.total_rps:.0f} RPS")
        print(f"   - Capacity: Can handle more load")
    elif error_rate < 0.05:
        print(f"⚠️  SERVICE AT CAPACITY")
        print(f"   - Error rate: {error_rate*100:.2f}% (1-5%)")
        print(f"   - Sustained: {stats.total_rps:.0f} RPS")
        print(f"   - Capacity: Near limits")
    else:
        print(f"❌ SERVICE OVERLOADED")
        print(f"   - Error rate: {error_rate*100:.2f}% (> 5%)")
        print(f"   - Attempted: {stats.total_rps:.0f} RPS")
        print(f"   - Capacity: Exceeded limits")

    if p99 > 1000:
        print(f"⚠️  HIGH P99 LATENCY: {p99}ms (> 1000ms SLA)")
    if p95 > 500:
        print(f"⚠️  HIGH P95 LATENCY: {p95}ms (> 500ms SLA)")

    print(f"{'='*70}\n")

    # Save detailed results
    results = {
        "test_type": "stress",
        "p50_ms": p50,
        "p95_ms": p95,
        "p99_ms": p99,
        "p999_ms": p999,
        "max_ms": stats.max_response_time,
        "error_rate": error_rate,
        "total_requests": stats.num_requests,
        "failed_requests": stats.num_failures,
        "rps_avg": stats.total_rps if hasattr(stats, "total_rps") else 0,
        "capacity_assessment": "good" if error_rate < 0.01 else "at_capacity" if error_rate < 0.05 else "overloaded",
    }

    with open("/mnt/locust/reports/stress_test_results.json", "w") as f:
        json.dump(results, f, indent=2)

    print("📊 Detailed results saved to: stress_test_results.json\n")

    # Stress test doesn't fail the build - we expect to hit limits
    environment.process_exit_code = 0
