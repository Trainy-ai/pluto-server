#!/usr/bin/env python3
import json
import sys


def compare_results(baseline_path: str, current_path: str) -> bool:
    with open(baseline_path) as f:
        baseline = json.load(f)
    with open(current_path) as f:
        current = json.load(f)

    LATENCY_THRESHOLD = 0.20  # 20% increase allowed
    ERROR_THRESHOLD = 0.05  # 5% absolute increase

    failures = []

    # Check p95 regression
    p95_regression = (current["p95_ms"] - baseline["p95_ms"]) / baseline["p95_ms"]
    if p95_regression > LATENCY_THRESHOLD:
        failures.append(
            f"p95 regression: {p95_regression*100:.1f}% (baseline: {baseline['p95_ms']}ms, current: {current['p95_ms']}ms)"
        )

    # Check p99 regression
    p99_regression = (current["p99_ms"] - baseline["p99_ms"]) / baseline["p99_ms"]
    if p99_regression > LATENCY_THRESHOLD:
        failures.append(f"p99 regression: {p99_regression*100:.1f}%")

    # Check error rate
    error_increase = current["error_rate"] - baseline["error_rate"]
    if error_increase > ERROR_THRESHOLD:
        failures.append(f"Error rate increased by {error_increase*100:.2f}%")

    if failures:
        print("❌ PERFORMANCE REGRESSION DETECTED:")
        for failure in failures:
            print(f"  - {failure}")
        return False
    else:
        print("✅ Performance within baseline thresholds")
        return True


if __name__ == "__main__":
    passed = compare_results(sys.argv[1], sys.argv[2])
    sys.exit(0 if passed else 1)
