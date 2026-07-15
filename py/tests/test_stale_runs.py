"""
Unit tests for the stale run job (process_runs).

Uses unittest.mock to test logic in isolation — no DB or ClickHouse needed.
Run with: pytest tests/test_stale_runs.py -vv -s
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from python.models import NotificationType


def make_run(run_id, updated_minutes_ago=5, logger_settings=None, has_project=True):
    """Create a mock Run object."""
    run = MagicMock()
    run.id = run_id
    run.name = f"run-{run_id}"
    run.status = "RUNNING"
    run.organizationId = "org-1"
    run.updatedAt = datetime.now(timezone.utc) - timedelta(minutes=updated_minutes_ago)
    run.loggerSettings = logger_settings

    if has_project:
        run.project = MagicMock()
        run.project.name = "test-project"
    else:
        run.project = None

    run.organization = MagicMock()
    run.organization.slug = "test-org"
    return run


def make_ch_result(rows):
    """Create a mock ClickHouse query result."""
    result = MagicMock()
    result.result_rows = rows
    return result


def make_session(runs, heartbeat_rows=None, lock=True, heartbeat_error=False):
    """Mock a SQLAlchemy session that dispatches on the executed SQL.

    - the advisory-lock probe returns `lock`,
    - the run_heartbeats SELECT returns `heartbeat_rows` (list of
      (run_id, datetime) tuples), or raises when `heartbeat_error` is set,
    - everything else (transition_run_status's SELECT/UPDATE/INSERT) returns a
      generic mock, matching how the pre-existing tests drive process_runs.
    """

    session = MagicMock()
    session.query.return_value.filter.return_value.all.return_value = runs

    def _execute(stmt, params=None):
        sql = str(stmt)
        res = MagicMock()
        if "pg_try_advisory_xact_lock" in sql:
            res.scalar.return_value = lock
        elif "run_heartbeats" in sql:
            if heartbeat_error:
                raise RuntimeError("db read failed")
            res.fetchall.return_value = heartbeat_rows or []
        else:
            res.scalar.return_value = None
        return res

    session.execute.side_effect = _execute
    return session


class TestProcessRunsStaleDetection:
    """Tests for stale run detection logic."""

    @patch("python.server.send_alert")
    def test_stale_run_marked_failed(self, mock_send_alert):
        """Run with CH metric >grace seconds ago is marked FAILED."""
        from python.server import process_runs

        run = make_run(100, updated_minutes_ago=60)
        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = [run]

        old_time = datetime.now(timezone.utc) - timedelta(minutes=60)
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([(100, old_time)])

        result = process_runs(session, ch_client, smtp_config={}, grace=600)

        assert run.status == "FAILED"
        mock_send_alert.assert_called_once()
        assert 100 in result
        session.commit.assert_called_once()

    @patch("python.server.send_alert")
    def test_active_run_not_marked(self, mock_send_alert):
        """Run with recent CH metric stays RUNNING."""
        from python.server import process_runs

        run = make_run(200, updated_minutes_ago=1)
        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = [run]

        recent_time = datetime.now(timezone.utc) - timedelta(seconds=30)
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([(200, recent_time)])

        result = process_runs(session, ch_client, smtp_config={}, grace=600)

        assert run.status == "RUNNING"
        mock_send_alert.assert_not_called()
        assert result == []

    @patch("python.server.send_alert")
    def test_no_metrics_falls_back_to_updated_at(self, mock_send_alert):
        """Run with no CH metrics uses updatedAt as fallback; marks stale if old."""
        from python.server import process_runs

        run = make_run(300, updated_minutes_ago=60)
        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = [run]

        # No rows for this run in CH
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([])

        result = process_runs(session, ch_client, smtp_config={}, grace=600)

        assert run.status == "FAILED"
        assert 300 in result

    @patch("python.server.send_alert")
    def test_null_logger_settings_no_crash(self, mock_send_alert):
        """Run with loggerSettings=None doesn't raise AttributeError."""
        from python.server import process_runs

        run = make_run(400, updated_minutes_ago=60, logger_settings=None)
        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = [run]

        old_time = datetime.now(timezone.utc) - timedelta(minutes=60)
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([(400, old_time)])

        # Should not raise
        result = process_runs(session, ch_client, smtp_config={}, grace=600)
        assert 400 in result

    @patch("python.server.send_alert")
    def test_clickhouse_error_skips_cycle(self, mock_send_alert):
        """ClickHouse query failure → returns early, no commit."""
        from python.server import process_runs

        run = make_run(500)
        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = [run]

        ch_client = MagicMock()
        ch_client.query.side_effect = Exception("CH connection refused")

        result = process_runs(session, ch_client, smtp_config={}, grace=600)

        assert result is None
        session.commit.assert_not_called()

    @patch("python.server.send_alert")
    def test_commit_error_rolls_back(self, mock_send_alert):
        """session.commit() failure triggers rollback."""
        from python.server import process_runs

        run = make_run(600, updated_minutes_ago=60)
        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = [run]
        session.commit.side_effect = Exception("DB write error")

        old_time = datetime.now(timezone.utc) - timedelta(minutes=60)
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([(600, old_time)])

        result = process_runs(session, ch_client, smtp_config={}, grace=600)

        session.rollback.assert_called_once()

    @patch("python.server.send_alert")
    def test_multiple_stale_runs_all_tracked(self, mock_send_alert):
        """Multiple stale runs → all IDs in result, single commit."""
        from python.server import process_runs

        runs = [make_run(i, updated_minutes_ago=60) for i in [701, 702, 703]]
        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = runs

        old_time = datetime.now(timezone.utc) - timedelta(minutes=60)
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result(
            [(701, old_time), (702, old_time), (703, old_time)]
        )

        result = process_runs(session, ch_client, smtp_config={}, grace=600)

        assert set(result) == {701, 702, 703}
        assert mock_send_alert.call_count == 3
        session.commit.assert_called_once()

    @patch("python.server.send_alert")
    def test_no_running_runs(self, mock_send_alert):
        """No RUNNING runs → returns empty list, no CH query."""
        from python.server import process_runs

        session = MagicMock()
        session.query.return_value.filter.return_value.all.return_value = []

        ch_client = MagicMock()

        result = process_runs(session, ch_client, smtp_config={}, grace=600)

        assert result == []
        ch_client.query.assert_not_called()


class TestProcessRunsHeartbeat:
    """Tests for heartbeat-based liveness detection (the primary signal)."""

    @pytest.fixture(autouse=True)
    def _past_warm_up(self, monkeypatch):
        """Simulate a long-running process: the boot-race guard in
        process_runs skips heartbeat judgement for the first heartbeat_grace
        seconds after process start, which would otherwise mask every
        assertion in this class (tests import the module seconds before
        running)."""
        import time

        import python.server as ps

        monkeypatch.setattr(ps, "_PROCESS_STARTED_AT", time.monotonic() - 10_000)

    @patch("python.server.transition_run_status")
    @patch("python.server.send_alert")
    def test_stale_heartbeat_marks_failed(self, mock_send_alert, mock_transition):
        """A run whose heartbeat AND metrics are both quiet past heartbeat_grace
        is marked FAILED with the heartbeat reason."""
        from python.server import process_runs

        run = make_run(100)
        old_hb = datetime.now(timezone.utc) - timedelta(seconds=120)
        session = make_session([run], heartbeat_rows=[(100, old_hb)])

        # No fresh metric activity either.
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([])

        result = process_runs(
            session, ch_client, smtp_config={}, grace=1800, heartbeat_grace=90
        )

        assert run.status == "FAILED"
        assert 100 in result
        mock_send_alert.assert_called_once()
        # Reason + applied threshold are recorded on the transition.
        meta = mock_transition.call_args.kwargs["metadata"]
        assert meta["reason"] == "heartbeat-timeout"
        assert meta["grace_seconds"] == 90

    @patch("python.server.transition_run_status")
    @patch("python.server.send_alert")
    def test_stale_heartbeat_but_fresh_metric_keeps_running(
        self, mock_send_alert, mock_transition
    ):
        """A frozen heartbeat must NOT reap a run that is still logging metrics.

        Regression for the false-positive where a failed heartbeat write leaves
        `lastSeen` stale while training is healthy: fresh ClickHouse activity
        keeps the run RUNNING even though the heartbeat is past its grace."""
        from python.server import process_runs

        run = make_run(100)
        old_hb = datetime.now(timezone.utc) - timedelta(seconds=300)
        session = make_session([run], heartbeat_rows=[(100, old_hb)])

        # Metric logged 5s ago — the run is clearly alive.
        recent = datetime.now(timezone.utc) - timedelta(seconds=5)
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([(100, recent)])

        result = process_runs(
            session, ch_client, smtp_config={}, grace=1800, heartbeat_grace=90
        )

        assert run.status == "RUNNING"
        mock_transition.assert_not_called()
        mock_send_alert.assert_not_called()
        assert result == []

    @patch("python.server.send_alert")
    def test_fresh_heartbeat_keeps_running(self, mock_send_alert):
        """A fresh heartbeat keeps the run RUNNING even when the last metric /
        updatedAt is ancient — heartbeat overrides the stale metric signal."""
        from python.server import process_runs

        run = make_run(200, updated_minutes_ago=60)
        fresh_hb = datetime.now(timezone.utc) - timedelta(seconds=10)
        session = make_session([run], heartbeat_rows=[(200, fresh_hb)])

        old_time = datetime.now(timezone.utc) - timedelta(minutes=60)
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([(200, old_time)])

        result = process_runs(
            session, ch_client, smtp_config={}, grace=1800, heartbeat_grace=90
        )

        assert run.status == "RUNNING"
        mock_send_alert.assert_not_called()
        assert result == []

    @patch("python.server.transition_run_status")
    @patch("python.server.send_alert")
    def test_no_heartbeat_uses_clickhouse_grace(self, mock_send_alert, mock_transition):
        """With no heartbeat row, detection falls back to the ClickHouse signal
        on the *looser* `grace`, not the tight `heartbeat_grace`."""
        from python.server import process_runs

        run = make_run(300)
        session = make_session([run], heartbeat_rows=[])  # no heartbeat

        # Metric 5 min old: past heartbeat_grace (90s) but under grace (600s),
        # so the run must stay RUNNING — proving the fallback uses `grace`.
        five_min_ago = datetime.now(timezone.utc) - timedelta(minutes=5)
        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([(300, five_min_ago)])

        result = process_runs(
            session, ch_client, smtp_config={}, grace=600, heartbeat_grace=90
        )

        assert run.status == "RUNNING"
        mock_transition.assert_not_called()
        assert result == []


class TestProcessRunsHeartbeatReadFailure:
    """A failed run_heartbeats read must skip the cycle, not silently demote
    heartbeat-tracked runs to the fallback path (whose signals — updatedAt /
    last metric — can be legitimately old on a healthy, heartbeating run)."""

    @patch("python.server.transition_run_status")
    @patch("python.server.send_alert")
    def test_heartbeat_read_error_skips_cycle(self, mock_send_alert, mock_transition):
        from python.server import process_runs

        # updatedAt 60 min old and no metrics: would be reaped by the
        # fallback path if the read error were treated as "no heartbeats".
        run = make_run(100, updated_minutes_ago=60)
        session = make_session([run], heartbeat_error=True)

        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([])

        result = process_runs(
            session, ch_client, smtp_config={}, grace=1800, heartbeat_grace=150
        )

        assert result is None  # cycle skipped, mirroring the ClickHouse path
        assert run.status == "RUNNING"
        mock_transition.assert_not_called()
        mock_send_alert.assert_not_called()


class TestProcessRunsWarmUp:
    """Tests for the boot-race guard: a freshly started process must not
    judge heartbeat staleness (nothing was up to record pings during the
    outage that preceded it)."""

    @patch("python.server.transition_run_status")
    @patch("python.server.send_alert")
    def test_warm_up_skips_heartbeat_tracked_runs(
        self, mock_send_alert, mock_transition, monkeypatch
    ):
        """During warm-up a stale heartbeat must NOT reap the run, but a
        no-heartbeat run past the fallback grace is still reaped."""
        import time

        import python.server as ps
        from python.server import process_runs

        monkeypatch.setattr(ps, "_PROCESS_STARTED_AT", time.monotonic())

        hb_run = make_run(100)
        fallback_run = make_run(200, updated_minutes_ago=60)
        stale_hb = datetime.now(timezone.utc) - timedelta(seconds=600)
        session = make_session(
            [hb_run, fallback_run], heartbeat_rows=[(100, stale_hb)]
        )

        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([])

        result = process_runs(
            session, ch_client, smtp_config={}, grace=1800, heartbeat_grace=150
        )

        # Heartbeat-tracked run is left alone despite a 10-minute-stale row.
        assert hb_run.status == "RUNNING"
        # The fallback run (no heartbeat row, updatedAt 60 min old) is still
        # reaped — warm-up only suspends the heartbeat signal.
        assert 200 in result
        assert mock_transition.call_args.kwargs["run_id"] == 200

    @patch("python.server.transition_run_status")
    @patch("python.server.send_alert")
    def test_after_warm_up_stale_heartbeat_reaps(
        self, mock_send_alert, mock_transition, monkeypatch
    ):
        """Once the process has been up past heartbeat_grace, the same stale
        heartbeat leads to a reap (contrast with the warm-up test above)."""
        import time

        import python.server as ps
        from python.server import process_runs

        monkeypatch.setattr(ps, "_PROCESS_STARTED_AT", time.monotonic() - 151)

        run = make_run(100)
        stale_hb = datetime.now(timezone.utc) - timedelta(seconds=600)
        session = make_session([run], heartbeat_rows=[(100, stale_hb)])

        ch_client = MagicMock()
        ch_client.query.return_value = make_ch_result([])

        result = process_runs(
            session, ch_client, smtp_config={}, grace=1800, heartbeat_grace=150
        )

        assert run.status == "FAILED"
        assert 100 in result


class TestProcessRunsAdvisoryLock:
    """Tests for the Postgres advisory lock."""

    @patch("python.server.send_alert")
    def test_lock_not_acquired_skips_cycle(self, mock_send_alert):
        """When another instance holds the lock, skip the cycle."""
        from python.server import process_runs

        session = MagicMock()
        session.execute.return_value.scalar.return_value = False

        ch_client = MagicMock()
        result = process_runs(session, ch_client, smtp_config={}, grace=600)

        assert result == []
        ch_client.query.assert_not_called()
        session.commit.assert_not_called()


class TestProcessRunsGracePeriod:
    """Tests for the default grace period."""

    def test_default_grace_is_1800(self):
        """Verify default (fallback) grace period is 1800s (30 min)."""
        import inspect
        from python.server import process_runs

        sig = inspect.signature(process_runs)
        assert sig.parameters["grace"].default == 1800

    def test_default_heartbeat_grace_is_150(self):
        """Verify the tight heartbeat grace default is 150s — 5x the 30s
        coalesce window, so a couple of missed refreshes don't false-reap."""
        import inspect
        from python.server import process_runs

        sig = inspect.signature(process_runs)
        assert sig.parameters["heartbeat_grace"].default == 150
