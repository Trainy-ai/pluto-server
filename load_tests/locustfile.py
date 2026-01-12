import json
import logging
import os
import random
import time

import pluto  # pluto-ml-nightly SDK
from locust import User, between, events, task

from config import config


class IngestUser(User):
    """Load test user that uses the official pluto SDK"""

    wait_time = between(0.1, 0.5)

    def on_start(self):
        """Initialize mlop SDK client (happens once per user)"""
        self.step = 0

        try:
            # Configure SDK to use local services by setting URL attributes directly
            settings = pluto.Settings()
            settings.url_api = "http://server:3001"
            settings.url_ingest = "http://ingest:3003"
            settings.url_app = "http://server:3001"
            settings.url_py = "http://server:3001"
            settings._auth = config.api_key  # Set the API key on settings

            # Call update to trigger update_host() and update_url()
            settings.update({})

            # Login with custom settings (non-interactive)
            pluto.login(settings=settings)
            logging.info("Logged in with API key")

            # Initialize a run for this simulated user
            self.run = pluto.init(
                project="load-test-project",
                name=f"load-test-run-{id(self)}",
                config={
                    "test_type": "load_test",
                    "target_rps": 1000,
                },
                settings=settings,
            )
            logging.info(f"Initialized SDK run: {self.run}")
        except Exception as e:
            logging.error(f"Failed to initialize SDK: {e}", exc_info=True)
            self.run = None

    def on_stop(self):
        """Clean up run when user stops"""
        if self.run:
            try:
                self.run.finish()
            except Exception as e:
                logging.error(f"Failed to finish run: {e}")

    @task(5)  # 50% of traffic
    def log_metrics(self):
        """Log multiple metrics using SDK (most common operation)"""
        if not self.run:
            return

        self.step += 1

        try:
            start_time = time.time()

            # Log batch of metrics (typical training loop pattern)
            self.run.log({
                "train/loss": random.uniform(0, 1),
                "train/accuracy": random.uniform(0.8, 1.0),
                "val/loss": random.uniform(0, 1),
                "val/accuracy": random.uniform(0.75, 0.95),
                "learning_rate": random.uniform(0.0001, 0.001),
                "epoch": self.step,
            })

            # Track latency manually for SDK calls
            latency = (time.time() - start_time) * 1000
            events.request.fire(
                request_type="SDK",
                name="run.log (metrics)",
                response_time=latency,
                response_length=0,
                exception=None,
                context={},
            )

        except Exception as e:
            events.request.fire(
                request_type="SDK",
                name="run.log (metrics)",
                response_time=0,
                response_length=0,
                exception=e,
                context={},
            )

    @task(3)  # 30% of traffic
    def log_with_step(self):
        """Log metrics with explicit step (alternative pattern)"""
        if not self.run:
            return

        self.step += 1

        try:
            start_time = time.time()

            # Log with explicit step using internal API
            # (some users may use this pattern for more control)
            self.run._log(
                data={
                    "batch/loss": random.uniform(0, 1.5),
                    "batch/size": random.randint(16, 128),
                },
                step=self.step,
                t=time.time(),
            )

            latency = (time.time() - start_time) * 1000
            events.request.fire(
                request_type="SDK",
                name="run._log (explicit step)",
                response_time=latency,
                response_length=0,
                exception=None,
                context={},
            )

        except Exception as e:
            events.request.fire(
                request_type="SDK",
                name="run._log (explicit step)",
                response_time=0,
                response_length=0,
                exception=e,
                context={},
            )


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Validate performance thresholds and fail CI if exceeded"""
    stats = environment.stats.total

    p50 = stats.get_response_time_percentile(0.5)
    p95 = stats.get_response_time_percentile(0.95)
    p99 = stats.get_response_time_percentile(0.99)
    error_rate = stats.fail_ratio

    logging.info(
        f"Results: p50={p50}ms, p95={p95}ms, p99={p99}ms, errors={error_rate*100:.2f}%"
    )

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
    if p95 > config.p95_threshold_ms:
        logging.error(f"FAILED: p95 {p95}ms exceeds {config.p95_threshold_ms}ms")
        environment.process_exit_code = 1

    if p99 > config.p99_threshold_ms:
        logging.error(f"FAILED: p99 {p99}ms exceeds {config.p99_threshold_ms}ms")
        environment.process_exit_code = 1

    if error_rate > config.max_error_rate:
        logging.error(
            f"FAILED: Error rate {error_rate*100:.2f}% exceeds {config.max_error_rate*100}%"
        )
        environment.process_exit_code = 1
