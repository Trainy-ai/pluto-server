"""
Quick test for NaN, Infinity, and -Infinity metric ingestion.

Verifies the ingest pipeline accepts non-finite float values that are
common in ML training (e.g. gradient explosions, data statistics).

Usage:
    # Against local Docker Compose
    TEST_LOCAL=true python tests/e2e/test_non_finite_metrics.py

    # Against dev environment
    python tests/e2e/test_non_finite_metrics.py
"""

import math
import os
import time

import pluto


def main():
    # Pass settings as a dict so pluto.init()'s setup() reads PLUTO_API_KEY
    # from the environment. Passing a Settings object skips env var reading.
    settings_dict = {}
    if os.getenv("TEST_LOCAL", "").lower() in ("true", "1", "yes"):
        settings_dict = {
            "url_app": "http://localhost:3000",
            "url_api": "http://localhost:3001",
            "url_ingest": "http://localhost:3003",
            "url_py": "http://localhost:3004",
        }
    elif os.getenv("TEST_CI", "").lower() in ("true", "1", "yes"):
        settings_dict = {
            "url_app": os.getenv("CI_APP_URL", "http://server:3001"),
            "url_api": os.getenv("CI_API_URL", "http://server:3001"),
            "url_ingest": os.getenv("CI_INGEST_URL", "http://ingest:3003"),
            "url_py": os.getenv("CI_PY_URL", "http://python:3004"),
        }

    run = pluto.init(
        project="test-non-finite",
        name="nan-inf-test",
        config={"purpose": "test non-finite metric values"},
        settings=settings_dict,
    )

    # Step 0: Normal metrics (baseline)
    run.log({"train/loss": 0.5, "train/acc": 0.95}, step=0)
    print("Step 0: normal metrics")

    # Step 1: NaN (e.g. 0/0 in loss computation)
    run.log({"train/loss": float("nan"), "train/acc": 0.90}, step=1)
    print("Step 1: NaN loss + normal acc")

    # Step 2: Infinity (e.g. gradient explosion)
    run.log({"train/loss": float("inf"), "train/acc": 0.85}, step=2)
    print("Step 2: Inf loss + normal acc")

    # Step 3: -Infinity (e.g. log(0) in log-likelihood)
    run.log({"train/loss": float("-inf"), "train/acc": 0.80}, step=3)
    print("Step 3: -Inf loss + normal acc")

    # Step 4: All non-finite in one batch
    run.log(
        {
            "debug/nan_metric": float("nan"),
            "debug/inf_metric": float("inf"),
            "debug/neg_inf_metric": float("-inf"),
            "debug/normal_metric": 42.0,
        },
        step=4,
    )
    print("Step 4: mixed non-finite + normal in one batch")

    # Step 5: Back to normal (verify pipeline recovers)
    run.log({"train/loss": 0.3, "train/acc": 0.97}, step=5)
    print("Step 5: normal metrics (recovery)")

    # Step 6: Python math module constants
    run.log(
        {
            "math/nan": math.nan,
            "math/inf": math.inf,
            "math/neg_inf": -math.inf,
        },
        step=6,
    )
    print("Step 6: math.nan / math.inf / -math.inf")

    # Steps 7-26: Mixed metric with normal values interspersed with non-finite
    # This simulates a real training run where gradient explosions cause
    # occasional NaN/Inf spikes in an otherwise normal loss curve.
    print("\nLogging mixed metric (train/mixed_loss) over 20 steps...")
    mixed_values = [
        0.9,            # step 7:  normal
        0.85,           # step 8:  normal
        0.78,           # step 9:  normal
        float("nan"),   # step 10: gradient explosion → NaN
        0.80,           # step 11: recovered
        0.72,           # step 12: normal
        0.65,           # step 13: normal
        float("inf"),   # step 14: loss overflow → Inf
        0.70,           # step 15: recovered
        0.60,           # step 16: normal
        0.55,           # step 17: normal
        0.50,           # step 18: normal
        float("-inf"),  # step 19: log-likelihood → -Inf
        0.48,           # step 20: recovered
        0.42,           # step 21: normal
        float("nan"),   # step 22: another NaN spike
        0.38,           # step 23: recovered
        0.33,           # step 24: normal
        0.28,           # step 25: normal
        0.22,           # step 26: normal (final)
    ]
    for i, val in enumerate(mixed_values):
        step = 7 + i
        run.log({"train/mixed_loss": val}, step=step)
    print(f"Steps 7-26: mixed_loss with {sum(1 for v in mixed_values if not math.isfinite(v))} non-finite values in 20 steps")

    time.sleep(1)
    run.finish()
    print("\nDone — check the run in the UI to verify:")
    print("  - Charts show gaps for NaN/Inf steps")
    print("  - Metric summaries (min/max/avg) are not poisoned")
    print("  - Normal metrics around non-finite values display correctly")
    print("  - train/mixed_loss shows a line with gaps at steps 10, 14, 19, 22")


if __name__ == "__main__":
    main()
