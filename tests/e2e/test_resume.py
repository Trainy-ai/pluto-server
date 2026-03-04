"""
E2E test for the resume-by-display-ID feature.

Tests the full flow:
1. Create a run -> finish it -> resume by numeric ID -> log new metrics -> finish
2. Resume by display ID (e.g., "MML-26") -> log new metrics -> finish
3. Backward compatibility: external ID (multi-node DDP pattern)

Usage:
    # Against local Docker Compose
    PLUTO_API_KEY=mlpi_... TEST_LOCAL=true python tests/e2e/test_resume.py

    # In CI (called by Buildkite pipeline)
    TEST_CI=true CI_API_URL=http://server:3001 CI_INGEST_URL=http://ingest:3003 \
        PLUTO_API_KEY=... python tests/e2e/test_resume.py
"""

import os
import time

import httpx
import pluto


def is_ci() -> bool:
    """Check if running in CI environment."""
    return os.getenv("TEST_CI", "").lower() in ("true", "1", "yes")


def get_settings_dict() -> dict:
    """Return a settings dict based on environment (local vs CI).

    PLUTO_API_KEY is read from the environment by the SDK automatically,
    so we only need to set URL overrides here.
    """
    if is_ci():
        return {
            "url_app": os.getenv("CI_APP_URL", "http://server:3001"),
            "url_api": os.getenv("CI_API_URL", "http://server:3001"),
            "url_ingest": os.getenv("CI_INGEST_URL", "http://ingest:3003"),
            "url_py": os.getenv("CI_PY_URL", "http://python:3004"),
        }
    # Local Docker Compose
    return {
        "url_app": "http://localhost:3000",
        "url_api": "http://localhost:3001",
        "url_ingest": "http://localhost:3003",
        "url_py": "http://localhost:3004",
    }


def get_api_url() -> str:
    """Return the API base URL for direct HTTP calls."""
    return get_settings_dict()["url_api"]


def get_display_id(run_id: int) -> str:
    """Query the display ID for a run via the HTTP API."""
    api_key = os.environ["PLUTO_API_KEY"]
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resp = httpx.get(
        f"{get_api_url()}/api/runs/details/{run_id}",
        headers=headers,
    )
    resp.raise_for_status()
    display_id = resp.json()["displayId"]
    assert display_id is not None, f"Run {run_id} has no displayId"
    return display_id


def test_resume_by_numeric_id(settings_dict):
    """Test 1: Create run, finish, resume by numeric ID."""
    print("\n=== Test 1: Resume by numeric ID ===")

    run = pluto.init(
        project="my-ml-project", name="e2e-resume-numeric", settings=settings_dict
    )
    run_id = run.id
    print(f"  Created run {run_id}, resumed={run.resumed}")
    assert run.resumed is False, f"Expected resumed=False, got {run.resumed}"

    run.log({"train/loss": 0.5, "train/accuracy": 0.8})
    run.finish()
    print(f"  Finished run {run_id}")

    # Resume by numeric ID
    run_resumed = pluto.init(
        project="my-ml-project", name="ignored", run_id=run_id, settings=settings_dict
    )
    print(f"  Resumed run: id={run_resumed.id}, resumed={run_resumed.resumed}")
    assert (
        run_resumed.resumed is True
    ), f"Expected resumed=True, got {run_resumed.resumed}"
    assert run_resumed.id == run_id, f"Expected id={run_id}, got {run_resumed.id}"

    run_resumed.log({"eval/accuracy": 0.95})
    run_resumed.finish()
    print(f"  PASS: Resume by numeric ID ({run_id})")
    return run_id


def test_resume_by_display_id(settings_dict, run_id: int):
    """Test 2: Resume by display ID (e.g., 'MML-26')."""
    print("\n=== Test 2: Resume by display ID ===")

    display_id = get_display_id(run_id)
    print(f"  Display ID for run {run_id}: {display_id}")

    run = pluto.init(
        project="my-ml-project",
        name="ignored",
        run_id=display_id,
        settings=settings_dict,
    )
    print(f"  Resumed run: id={run.id}, resumed={run.resumed}")
    assert run.resumed is True, f"Expected resumed=True, got {run.resumed}"
    assert run.id == run_id, f"Expected id={run_id}, got {run.id}"

    run.log({"eval/f1": 0.92})
    run.finish()
    print(f"  PASS: Resume by display ID ({display_id})")


def test_backward_compat_external_id(settings_dict):
    """Test 3: Backward compatibility -- external ID (multi-node DDP pattern)."""
    print("\n=== Test 3: Backward compat with externalId ===")

    ext_id = f"e2e-compat-{int(time.time())}"

    run = pluto.init(
        project="my-ml-project",
        name="e2e-external-id",
        run_id=ext_id,
        settings=settings_dict,
    )
    print(f"  Created run: id={run.id}, resumed={run.resumed}")
    assert run.resumed is False, f"Expected resumed=False, got {run.resumed}"
    run_id = run.id
    run.finish()

    # Same external ID -> should resume existing run
    run2 = pluto.init(
        project="my-ml-project",
        name="e2e-external-id",
        run_id=ext_id,
        settings=settings_dict,
    )
    print(f"  Resumed run: id={run2.id}, resumed={run2.resumed}")
    assert run2.resumed is True, f"Expected resumed=True, got {run2.resumed}"
    assert run2.id == run_id, f"Expected id={run_id}, got {run2.id}"
    run2.finish()
    print(f"  PASS: Backward compat with externalId ({ext_id})")


def main():
    api_key = os.environ.get("PLUTO_API_KEY")
    if not api_key:
        print("ERROR: Set PLUTO_API_KEY environment variable")
        print(
            "  Get it from: docker compose exec db psql -U postgres"
            ' -d postgres -t -q -c "SELECT key FROM api_key LIMIT 1;"'
        )
        exit(1)

    settings_dict = get_settings_dict()
    print("E2E Resume Tests")
    print(f"  API: {get_api_url()}")

    run_id = test_resume_by_numeric_id(settings_dict)
    test_resume_by_display_id(settings_dict, run_id)
    test_backward_compat_external_id(settings_dict)

    print("\nAll e2e resume tests passed!")


if __name__ == "__main__":
    main()
