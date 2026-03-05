"""
Integration tests for the stale run job against real Postgres + ClickHouse.

Requires the test infrastructure set up by .buildkite/setup-test-env.sh.
Run with: pytest tests/test_stale_runs_integration.py -vv -s -m integration
"""

import os
from datetime import datetime, timedelta, timezone

import pytest

# Skip entire module if not in integration environment
pytestmark = pytest.mark.integration


def get_test_db_url():
    """Get DATABASE_DIRECT_URL from environment (set by .env.test)."""
    url = os.getenv("DATABASE_DIRECT_URL")
    if not url:
        pytest.skip("DATABASE_DIRECT_URL not set — not in integration environment")
    return url


def get_ch_client():
    """Create a ClickHouse client from environment variables."""
    try:
        from clickhouse_connect import get_client as get_clickhouse_client
    except ImportError:
        pytest.skip("clickhouse-connect not installed")

    ch_url = os.getenv("CLICKHOUSE_URL", "")
    ch_user = os.getenv("CLICKHOUSE_USER", "default")
    ch_password = os.getenv("CLICKHOUSE_PASSWORD", "")

    if not ch_url:
        pytest.skip("CLICKHOUSE_URL not set — not in integration environment")

    try:
        host = ch_url.split("://")[1].split(":")[0]
        port = ch_url.split("://")[1].split(":")[1]
    except (IndexError, AttributeError):
        pytest.skip(f"Cannot parse CLICKHOUSE_URL: {ch_url}")

    return get_clickhouse_client(
        host=host, port=port, username=ch_user, password=ch_password
    )


def get_session(db_url):
    """Create a SQLAlchemy session."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    return Session(), engine


class TestStaleRunIntegration:
    """Integration test: process_runs against real PG + CH."""

    def test_stale_run_detected_and_marked(self):
        """A RUNNING run with no recent activity is marked FAILED."""
        from python.models import Run
        from python.server import process_runs

        db_url = get_test_db_url()
        session, engine = get_session(db_url)
        ch_client = get_ch_client()

        try:
            # Find an existing project + org to use
            existing_run = session.query(Run).first()
            if not existing_run:
                pytest.skip("No runs in test database")

            project_id = existing_run.projectId
            org_id = existing_run.organizationId

            # Create a RUNNING run with old updatedAt (no CH metrics → falls back to updatedAt)
            stale_run = Run(
                name="integration-test-stale",
                projectId=project_id,
                organizationId=org_id,
                status="RUNNING",
                updatedAt=datetime.now(timezone.utc) - timedelta(minutes=60),
            )
            session.add(stale_run)
            session.commit()
            stale_run_id = stale_run.id

            # Run the stale detection with a short grace period
            failed_ids = process_runs(
                session, ch_client, smtp_config={}, grace=10
            )

            # Refresh from DB to see the committed state
            session.refresh(stale_run)
            assert stale_run.status == "FAILED", (
                f"Expected FAILED, got {stale_run.status}"
            )
            assert stale_run_id in (failed_ids or [])

        finally:
            # Cleanup: delete the test run
            try:
                test_runs = (
                    session.query(Run)
                    .filter(Run.name == "integration-test-stale")
                    .all()
                )
                for r in test_runs:
                    session.delete(r)
                session.commit()
            except Exception:
                session.rollback()
            session.close()
            engine.dispose()

    def test_active_run_not_marked_with_fresh_session(self):
        """A RUNNING run with recent updatedAt stays RUNNING (validates session caching fix)."""
        from python.models import Run
        from python.server import process_runs

        db_url = get_test_db_url()
        session, engine = get_session(db_url)
        ch_client = get_ch_client()

        try:
            existing_run = session.query(Run).first()
            if not existing_run:
                pytest.skip("No runs in test database")

            project_id = existing_run.projectId
            org_id = existing_run.organizationId

            # Create a RUNNING run with fresh updatedAt
            active_run = Run(
                name="integration-test-active",
                projectId=project_id,
                organizationId=org_id,
                status="RUNNING",
                updatedAt=datetime.now(timezone.utc),
            )
            session.add(active_run)
            session.commit()
            active_run_id = active_run.id

            # Use a NEW session (simulating the fix in main.py)
            session2, _ = get_session(db_url)
            try:
                failed_ids = process_runs(
                    session2, ch_client, smtp_config={}, grace=1800
                )

                # Refresh from the new session
                refreshed = session2.query(Run).filter(Run.id == active_run_id).first()
                assert refreshed is not None
                assert refreshed.status == "RUNNING", (
                    f"Expected RUNNING, got {refreshed.status}"
                )
                assert active_run_id not in (failed_ids or [])
            finally:
                session2.close()

        finally:
            try:
                test_runs = (
                    session.query(Run)
                    .filter(Run.name == "integration-test-active")
                    .all()
                )
                for r in test_runs:
                    session.delete(r)
                session.commit()
            except Exception:
                session.rollback()
            session.close()
            engine.dispose()
