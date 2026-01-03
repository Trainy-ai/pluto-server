import os
from dataclasses import dataclass


@dataclass
class LoadTestConfig:
    ingest_url: str = os.getenv("INGEST_URL", "http://localhost:3003")
    api_key: str = os.getenv("TEST_API_KEY", "")

    # Thresholds
    p95_threshold_ms: float = float(os.getenv("P95_THRESHOLD_MS", "500"))
    p99_threshold_ms: float = float(os.getenv("P99_THRESHOLD_MS", "1000"))
    max_error_rate: float = float(os.getenv("MAX_ERROR_RATE", "0.01"))


config = LoadTestConfig()
