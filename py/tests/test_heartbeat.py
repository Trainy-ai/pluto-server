"""
Tests for heartbeat recording/reading against a real (in-memory SQLite) DB.

These exercise the actual SQL in `record_heartbeat` (SQLite dialect branch) and
`get_last_heartbeats` (portable `IN` query), catching syntax/portability bugs
that the fully-mocked process_runs tests cannot. Run with:
    pytest tests/test_heartbeat.py -vv
"""

import logging
import time
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def session():
    """In-memory SQLite session with a run_heartbeats table."""
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(
            text(
                'CREATE TABLE run_heartbeats ('
                '"runId" INTEGER PRIMARY KEY, '
                '"lastSeen" TIMESTAMP NOT NULL)'
            )
        )
    Session = sessionmaker(bind=engine)
    sess = Session()
    yield sess
    sess.close()
    engine.dispose()


def _last_seen(session, run_id):
    row = session.execute(
        text('SELECT "lastSeen" FROM run_heartbeats WHERE "runId" = :id'),
        {"id": run_id},
    ).fetchone()
    return row[0] if row else None


def test_record_heartbeat_inserts_row(session):
    from python.server import get_last_heartbeats, record_heartbeat

    record_heartbeat(session, 1)

    hb = get_last_heartbeats(session, [1])
    assert 1 in hb
    # Fresh — within a few seconds of now, and returned tz-aware.
    assert hb[1].tzinfo is not None
    age = (datetime.now(timezone.utc) - hb[1]).total_seconds()
    assert 0 <= age < 10


def test_record_heartbeat_coalesces_recent(session):
    """A ping inside the coalesce window is a no-op (lastSeen not refreshed)."""
    from python.server import record_heartbeat

    # Seed lastSeen 10s ago (inside the default 30s window).
    session.execute(
        text(
            'INSERT INTO run_heartbeats ("runId", "lastSeen") '
            "VALUES (1, datetime('now', '-10 seconds'))"
        )
    )
    session.commit()

    record_heartbeat(session, 1)

    # Still ~10s old — the write coalesced rather than refreshing to now.
    stored = datetime.fromisoformat(_last_seen(session, 1)).replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - stored).total_seconds()
    assert age >= 5, f"expected coalesced (~10s old) lastSeen, got age={age}s"


def test_record_heartbeat_refreshes_stale(session):
    """A ping past the coalesce window refreshes lastSeen to ~now."""
    from python.server import record_heartbeat

    # Seed lastSeen 60s ago (outside the default 30s window).
    session.execute(
        text(
            'INSERT INTO run_heartbeats ("runId", "lastSeen") '
            "VALUES (1, datetime('now', '-60 seconds'))"
        )
    )
    session.commit()

    record_heartbeat(session, 1)

    stored = datetime.fromisoformat(_last_seen(session, 1)).replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - stored).total_seconds()
    assert age < 5, f"expected refreshed (~0s old) lastSeen, got age={age}s"


def test_get_last_heartbeats_empty(session):
    from python.server import get_last_heartbeats

    assert get_last_heartbeats(session, []) == {}
    assert get_last_heartbeats(session, [999]) == {}


@pytest.fixture(autouse=True)
def _reset_failure_streak():
    """Isolate the module-level heartbeat write-failure streak between tests."""
    import python.server as ps

    ps._heartbeat_write_failures["consecutive"] = 0
    ps._heartbeat_write_failures["since"] = None
    yield
    ps._heartbeat_write_failures["consecutive"] = 0
    ps._heartbeat_write_failures["since"] = None


def _failing_session(exc=RuntimeError("db down")):
    bad = MagicMock()
    bad.get_bind.side_effect = exc
    return bad


def test_write_failure_streak_tracked_and_reset(session):
    """Failures build a streak visible via heartbeat_write_status();
    a successful write clears it."""
    from python.server import heartbeat_write_status, record_heartbeat

    assert heartbeat_write_status() == {"failing": False}

    bad = _failing_session()
    record_heartbeat(bad, 1)
    record_heartbeat(bad, 1)

    status = heartbeat_write_status()
    assert status["failing"] is True
    assert status["consecutiveFailures"] == 2
    assert status["failingForSeconds"] >= 0
    bad.rollback.assert_called()

    # A real successful write resets the streak.
    record_heartbeat(session, 1)
    assert heartbeat_write_status() == {"failing": False}


def test_write_failures_escalate_to_critical(caplog):
    """Once the failure streak spans the coalesce window (real staleness is
    accumulating), a CRITICAL log with a stable marker is emitted for
    log-based alerting."""
    import python.server as ps
    from python.server import record_heartbeat

    # Pretend the streak started well over a coalesce window ago.
    ps._heartbeat_write_failures["consecutive"] = 5
    ps._heartbeat_write_failures["since"] = (
        time.monotonic() - ps.HEARTBEAT_COALESCE_SECONDS - 60
    )

    with caplog.at_level(logging.CRITICAL, logger="stale-run-job"):
        record_heartbeat(_failing_session(), 1)

    assert any(
        "HEARTBEAT_WRITES_FAILING" in rec.message for rec in caplog.records
    ), "expected CRITICAL escalation marker once past the coalesce window"


def test_write_failures_below_window_do_not_escalate(caplog):
    """A brief blip (streak shorter than the coalesce window) logs the
    exception but does not fire the CRITICAL marker."""
    from python.server import record_heartbeat

    with caplog.at_level(logging.DEBUG, logger="stale-run-job"):
        record_heartbeat(_failing_session(), 1)

    assert not any(
        rec.levelno >= logging.CRITICAL for rec in caplog.records
    ), "first failure must not escalate to CRITICAL"
