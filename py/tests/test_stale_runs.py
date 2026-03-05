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
        """Verify default grace period is 1800s (30 min)."""
        import inspect
        from python.server import process_runs

        sig = inspect.signature(process_runs)
        assert sig.parameters["grace"].default == 1800
