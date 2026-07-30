"""
Resume-race tests for process_runs against a real (in-memory SQLite) DB.

The process_runs unit tests in test_stale_runs.py drive MagicMock Run objects,
so they prove the *decision* logic but not that `Runs.statusUpdated` is actually
mapped and read back as a comparable timestamp. That gap matters here: the whole
fix hinges on reading a real nullable timestamptz column through the ORM and
coercing it (psycopg2 datetime vs pysqlite ISO string, aware vs naive) before
comparing it against now(). A mocked ORM would happily pass even if the column
were misspelled or unmapped.

So these build genuine `Run` rows via the real model and let SQLAlchemy read
them back. `transition_run_status` and the advisory lock stay stubbed — both are
Postgres-only SQL (JSONB/enum casts, pg_try_advisory_xact_lock) covered by the
env-gated tests in test_stale_runs_integration.py.

Run with: pytest tests/test_stale_runs_resume_db.py -vv
"""

import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def db():
    """In-memory SQLite carrying the real model schema (runs, projects,
    run_heartbeats, ...) built from the same declarative Base production uses.

    `pg_try_advisory_xact_lock` is registered as a SQLite UDF returning 1 so the
    real lock-acquisition line in process_runs executes unmodified rather than
    being patched out.
    """
    from python.models import Base

    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def _register_pg_shims(dbapi_conn, _record):
        dbapi_conn.create_function("pg_try_advisory_xact_lock", 1, lambda _lock_id: 1)

    Base.metadata.create_all(engine)

    Session = sessionmaker(bind=engine)
    sess = Session()
    yield sess
    sess.close()
    engine.dispose()


@pytest.fixture(autouse=True)
def _past_warm_up(monkeypatch):
    """Past the boot-race guard so the heartbeat path is actually judged."""
    import python.server as ps

    monkeypatch.setattr(ps, "_PROCESS_STARTED_AT", time.monotonic() - 10_000)


def seed_run(session, run_id, *, status_updated, updated_at, heartbeat=None):
    """Insert a real project + RUNNING run, and optionally a heartbeat row."""
    from python.models import Project, Run, RunHeartbeat

    if session.get(Project, 1) is None:
        session.add(Project(id=1, name="test-project"))
        session.flush()

    session.add(
        Run(
            id=run_id,
            name=f"run-{run_id}",
            projectId=1,
            organizationId="org-1",
            status="RUNNING",
            statusUpdated=status_updated,
            updatedAt=updated_at,
        )
    )
    if heartbeat is not None:
        session.add(RunHeartbeat(runId=run_id, lastSeen=heartbeat))
    session.commit()


def no_metrics():
    """A ClickHouse client that reports no metric activity at all."""
    result = MagicMock()
    result.result_rows = []
    ch = MagicMock()
    ch.query.return_value = result
    return ch


@patch("python.server.transition_run_status")
@patch("python.server.send_alert")
def test_just_resumed_run_survives_against_real_row(
    mock_send_alert, mock_transition, db
):
    """The reported bug against a real DB row: heartbeat 6.7 h old, statusUpdated
    182 ms ago. The run must survive, proving statusUpdated round-trips through
    the ORM as a usable liveness signal."""
    from python.server import process_runs

    now = datetime.now(timezone.utc)
    seed_run(
        db,
        217983,
        status_updated=now - timedelta(milliseconds=182),
        updated_at=now,
        heartbeat=now - timedelta(seconds=24191),
    )

    result = process_runs(
        db, no_metrics(), smtp_config={}, grace=1800, heartbeat_grace=150
    )

    assert result == []
    mock_transition.assert_not_called()
    mock_send_alert.assert_not_called()


@patch("python.server.transition_run_status")
@patch("python.server.send_alert")
def test_abandoned_run_still_reaped_against_real_row(
    mock_send_alert, mock_transition, db
):
    """The counterpart: a real row whose statusUpdated is also old is still
    reaped, so the fix cannot be masking genuine death."""
    from python.server import process_runs

    now = datetime.now(timezone.utc)
    seed_run(
        db,
        217984,
        status_updated=now - timedelta(seconds=24000),
        updated_at=now - timedelta(seconds=24000),
        heartbeat=now - timedelta(seconds=24191),
    )

    result = process_runs(
        db, no_metrics(), smtp_config={}, grace=1800, heartbeat_grace=150
    )

    assert 217984 in result
    assert mock_transition.call_args.kwargs["run_id"] == 217984
    assert mock_transition.call_args.kwargs["metadata"]["reason"] == "heartbeat-timeout"


@patch("python.server.transition_run_status")
@patch("python.server.send_alert")
def test_null_status_updated_column_against_real_row(
    mock_send_alert, mock_transition, db
):
    """A real NULL in the nullable column must not crash the read path — runs
    predating statusUpdated still have to be judged on the data signals."""
    from python.server import process_runs

    now = datetime.now(timezone.utc)
    seed_run(
        db,
        217985,
        status_updated=None,
        updated_at=now - timedelta(seconds=24000),
        heartbeat=now - timedelta(seconds=24191),
    )

    result = process_runs(
        db, no_metrics(), smtp_config={}, grace=1800, heartbeat_grace=150
    )

    assert 217985 in result


@patch("python.server.transition_run_status")
@patch("python.server.send_alert")
def test_resumed_and_abandoned_runs_judged_independently(
    mock_send_alert, mock_transition, db
):
    """A resumed run and an abandoned one in the same cycle: only the abandoned
    one is reaped. Guards against the shield leaking across rows in the loop."""
    from python.server import process_runs

    now = datetime.now(timezone.utc)
    old_hb = now - timedelta(seconds=24191)
    seed_run(
        db,
        900,
        status_updated=now - timedelta(seconds=1),  # just resumed
        updated_at=now,
        heartbeat=old_hb,
    )
    seed_run(
        db,
        901,
        status_updated=now - timedelta(seconds=24000),  # long dead
        updated_at=now - timedelta(seconds=24000),
        heartbeat=old_hb,
    )

    result = process_runs(
        db, no_metrics(), smtp_config={}, grace=1800, heartbeat_grace=150
    )

    assert result == [901]
