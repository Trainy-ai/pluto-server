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

    def test_stale_heartbeat_marks_failed(self):
        """A RUNNING run with a stale run_heartbeats row is marked FAILED on the
        tight heartbeat grace, exercising the full heartbeat read path."""
        from sqlalchemy import text

        from python.models import Run
        from python.server import process_runs

        import time

        import python.server as ps

        db_url = get_test_db_url()
        session, engine = get_session(db_url)
        ch_client = get_ch_client()

        # Simulate a long-running process so the boot-race guard does not
        # skip heartbeat judgement (this test process just started).
        orig_started_at = ps._PROCESS_STARTED_AT
        ps._PROCESS_STARTED_AT = time.monotonic() - 10_000

        try:
            existing_run = session.query(Run).first()
            if not existing_run:
                pytest.skip("No runs in test database")

            run = Run(
                name="integration-test-heartbeat",
                projectId=existing_run.projectId,
                organizationId=existing_run.organizationId,
                status="RUNNING",
                updatedAt=datetime.now(timezone.utc),  # fresh — heartbeat decides
            )
            session.add(run)
            session.commit()
            run_id = run.id

            # Insert a heartbeat 5 minutes old.
            session.execute(
                text(
                    'INSERT INTO run_heartbeats ("runId", "lastSeen") '
                    "VALUES (:id, NOW() - make_interval(secs => 300))"
                ),
                {"id": run_id},
            )
            session.commit()

            failed_ids = process_runs(
                session, ch_client, smtp_config={}, grace=1800, heartbeat_grace=60
            )

            session.refresh(run)
            assert run.status == "FAILED", f"Expected FAILED, got {run.status}"
            assert run_id in (failed_ids or [])

        finally:
            ps._PROCESS_STARTED_AT = orig_started_at
            try:
                test_runs = (
                    session.query(Run)
                    .filter(Run.name == "integration-test-heartbeat")
                    .all()
                )
                for r in test_runs:
                    session.delete(r)  # cascade removes the heartbeat row
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


class TestHeartbeatPostgres:
    """Exercise record_heartbeat's POSTGRES branch against a real database.

    The unit tests in test_heartbeat.py execute the SQLite dialect branch;
    without this test the SQL that production actually runs (INSERT ... ON
    CONFLICT ... make_interval) is never asserted anywhere — record_heartbeat
    swallows errors by design, so even the SDK-driven E2E suites would not go
    red on a broken statement.
    """

    def test_record_heartbeat_postgres_upsert_and_coalesce(self):
        from sqlalchemy import text

        from python.server import (
            HEARTBEAT_COALESCE_SECONDS,
            get_last_heartbeats,
            record_heartbeat,
        )

        db_url = get_test_db_url()
        session, engine = get_session(db_url)
        run_id = None

        try:
            # Any existing run satisfies the FK; raw SQL keeps this test
            # independent of the ORM model's column set.
            row = session.execute(
                text('SELECT id FROM runs ORDER BY id LIMIT 1')
            ).fetchone()
            if not row:
                pytest.skip("No runs in test database")
            run_id = row[0]

            # Start clean so a leftover row from a prior test run cannot
            # turn the insert into a coalesced no-op.
            session.execute(
                text('DELETE FROM run_heartbeats WHERE "runId" = :id'),
                {"id": run_id},
            )
            session.commit()

            # 1) Insert path: row appears with a fresh lastSeen.
            record_heartbeat(session, run_id)
            hb = get_last_heartbeats(session, [run_id])
            assert hb is not None and run_id in hb, "insert branch failed"
            age = (datetime.now(timezone.utc) - hb[run_id]).total_seconds()
            assert age < 30, f"fresh lastSeen expected, got {age:.0f}s old"

            # 2) Coalesce path: backdate INSIDE the window — a ping must be
            # a no-op (lastSeen stays backdated).
            inside = HEARTBEAT_COALESCE_SECONDS // 2
            session.execute(
                text(
                    'UPDATE run_heartbeats SET "lastSeen" = '
                    'NOW() - make_interval(secs => :s) WHERE "runId" = :id'
                ),
                {"s": inside, "id": run_id},
            )
            session.commit()
            record_heartbeat(session, run_id)
            hb = get_last_heartbeats(session, [run_id])
            age = (datetime.now(timezone.utc) - hb[run_id]).total_seconds()
            assert age >= inside - 5, (
                f"ping inside the {HEARTBEAT_COALESCE_SECONDS}s window must "
                f"coalesce; lastSeen refreshed (age {age:.0f}s)"
            )

            # 3) Refresh path: backdate OUTSIDE the window — a ping must
            # rewrite lastSeen to ~now.
            session.execute(
                text(
                    'UPDATE run_heartbeats SET "lastSeen" = '
                    'NOW() - make_interval(secs => :s) WHERE "runId" = :id'
                ),
                {"s": HEARTBEAT_COALESCE_SECONDS * 2, "id": run_id},
            )
            session.commit()
            record_heartbeat(session, run_id)
            hb = get_last_heartbeats(session, [run_id])
            age = (datetime.now(timezone.utc) - hb[run_id]).total_seconds()
            assert age < HEARTBEAT_COALESCE_SECONDS, (
                f"ping outside the window must refresh lastSeen, got "
                f"{age:.0f}s old"
            )
        finally:
            if run_id is not None:
                try:
                    session.execute(
                        text('DELETE FROM run_heartbeats WHERE "runId" = :id'),
                        {"id": run_id},
                    )
                    session.commit()
                except Exception:
                    session.rollback()
            session.close()
            engine.dispose()
