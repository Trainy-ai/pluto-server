import hashlib
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from python.emails import send_email
from python.models import (
    ApiKey,
    Member,
    Notification,
    NotificationType,
    Organization,
    Run,
    RunStatus,
    User,
)
from python.run_status import transition_run_status
from python.templates import process_run_email
from python.utils import get_run_url

logger = logging.getLogger("stale-run-job")


def get_last_update_times(ch_client, run_ids):
    """Get last update times for all runs in a single batch query."""
    if not run_ids:
        return {}

    # Single query for all runs - much more efficient than N individual queries
    ch_query = """
        SELECT runId, MAX(time) AS last_update_time
        FROM mlop_metrics
        WHERE runId IN %(run_ids)s
        GROUP BY runId
    """

    try:
        result = ch_client.query(ch_query, parameters={"run_ids": tuple(run_ids)})
        last_updates = {}
        for row in result.result_rows:
            run_id, last_update_time = row[0], row[1]
            if last_update_time is not None:
                if isinstance(last_update_time, str):
                    try:
                        last_update_time = datetime.fromisoformat(last_update_time)
                    except ValueError:
                        continue
                if last_update_time.tzinfo is None:
                    last_update_time = last_update_time.replace(tzinfo=timezone.utc)
                last_updates[run_id] = last_update_time
        return last_updates
    except Exception as e:
        logger.exception("Error querying ClickHouse for batch")
        return None


def get_last_heartbeats(session, run_ids):
    """Batch-fetch the last heartbeat time per run from run_heartbeats.

    Returns {run_id: aware datetime}, or None on a read failure. A missing
    entry means "no heartbeat on record" and sends that run down the legacy
    fallback path; a failed read must NOT masquerade as that (an "empty"
    result would demote every heartbeat-tracked run to the fallback signals,
    which can be legitimately old — e.g. updatedAt on a long-running run —
    and falsely reap live runs). Callers skip the cycle on None, mirroring
    the ClickHouse fetch.
    """
    if not run_ids:
        return {}

    # `IN :ids` with an expanding bindparam works on both Postgres and SQLite
    # (local/test), unlike the Postgres-only `= ANY(:ids)`.
    stmt = text(
        'SELECT "runId", "lastSeen" FROM run_heartbeats WHERE "runId" IN :ids'
    ).bindparams(bindparam("ids", expanding=True))

    try:
        rows = session.execute(stmt, {"ids": list(run_ids)}).fetchall()
    except Exception:
        logger.exception("Error fetching heartbeats")
        return None

    heartbeats = {}
    for run_id, last_seen in rows:
        if last_seen is None:
            continue
        # psycopg2 returns a datetime; pysqlite (local/test) returns an ISO
        # string for a TIMESTAMP column, so parse it like get_last_update_times.
        if isinstance(last_seen, str):
            try:
                last_seen = datetime.fromisoformat(last_seen)
            except ValueError:
                continue
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        heartbeats[run_id] = last_seen
    return heartbeats


# The SDK monitor thread hits /api/runs/trigger every few seconds. We only need
# `lastSeen` to be at most this stale for the stale-run monitor to work, so the
# upsert refreshes the row at most once per this window. This coalescing is what
# keeps heartbeat writes cheap: an active run touches its heartbeat row ~once per
# HEARTBEAT_COALESCE_SECONDS regardless of poll rate, and DDP ranks sharing a
# runId collapse onto the same row. Keep it comfortably below the monitor's
# heartbeat grace (see process_runs `heartbeat_grace`): by design a healthy
# run's row may be this stale, so the grace must leave several missed windows
# of headroom (150s grace / 30s coalesce = 5x) before a run is reaped.
HEARTBEAT_COALESCE_SECONDS = int(os.getenv("HEARTBEAT_COALESCE_SECONDS", "30"))

# Process start reference for the boot-race guard in process_runs. On a fresh
# process every heartbeat row may be stale simply because nothing was up to
# record pings while this service was down — not because the runs are dead.
_PROCESS_STARTED_AT = time.monotonic()

# Heartbeat write-failure streak (per process; each replica tracks its own).
# record_heartbeat is deliberately best-effort, so without this a broken write
# path (bad migration, permissions, lock pile-up) would stay silent right up
# until the stale-run monitor mass-reaps healthy runs. Surfaced on /healthz
# and escalated to a CRITICAL log once staleness is genuinely accumulating.
_heartbeat_write_failures = {"consecutive": 0, "since": None}


def heartbeat_write_status():
    """Health snapshot of the heartbeat write path, exposed on /healthz.

    `failingForSeconds` beyond HEARTBEAT_COALESCE_SECONDS means stored
    `lastSeen` values are genuinely aging (a healthy run's row is allowed to
    be one coalesce window old); once they age past `heartbeat_grace` the
    stale-run monitor will falsely reap live runs. Alert well before that.
    """
    since = _heartbeat_write_failures["since"]
    if since is None:
        return {"failing": False}
    return {
        "failing": True,
        "consecutiveFailures": _heartbeat_write_failures["consecutive"],
        "failingForSeconds": int(time.monotonic() - since),
    }


def record_heartbeat(session, run_id):
    """Upsert the run's liveness timestamp, coalescing frequent pings.

    The INSERT ... ON CONFLICT writes a new row version only when the stored
    `lastSeen` is older than HEARTBEAT_COALESCE_SECONDS; a ping inside that
    window matches the WHERE-false branch and is a true no-op (no dead tuple,
    no WAL on Postgres). DDP ranks racing on the same runId serialise on the
    row and all but the first collapse to no-ops. Best-effort: a heartbeat
    failure must never break the cancel-trigger response, so we swallow and
    roll back. Branches on dialect so local/test SQLite works too.
    """
    try:
        if session.get_bind().dialect.name == "sqlite":
            # SQLite (local/test): ISO datetime text compares chronologically.
            session.execute(
                text(
                    """
                    INSERT INTO run_heartbeats ("runId", "lastSeen")
                    VALUES (:run_id, datetime('now'))
                    ON CONFLICT ("runId") DO UPDATE SET "lastSeen" = datetime('now')
                    WHERE run_heartbeats."lastSeen" < datetime('now', :neg_interval)
                    """
                ),
                {
                    "run_id": run_id,
                    "neg_interval": f"-{HEARTBEAT_COALESCE_SECONDS} seconds",
                },
            )
        else:
            session.execute(
                text(
                    """
                    INSERT INTO run_heartbeats ("runId", "lastSeen")
                    VALUES (:run_id, NOW())
                    ON CONFLICT ("runId") DO UPDATE SET "lastSeen" = NOW()
                    WHERE run_heartbeats."lastSeen"
                        < NOW() - make_interval(secs => :coalesce_seconds)
                    """
                ),
                {"run_id": run_id, "coalesce_seconds": HEARTBEAT_COALESCE_SECONDS},
            )
        session.commit()
        if _heartbeat_write_failures["since"] is not None:
            logger.info(
                "Heartbeat writes recovered after %d consecutive failures",
                _heartbeat_write_failures["consecutive"],
            )
        _heartbeat_write_failures["consecutive"] = 0
        _heartbeat_write_failures["since"] = None
    except Exception:
        _heartbeat_write_failures["consecutive"] += 1
        if _heartbeat_write_failures["since"] is None:
            _heartbeat_write_failures["since"] = time.monotonic()
        failing_for = time.monotonic() - _heartbeat_write_failures["since"]
        if failing_for >= HEARTBEAT_COALESCE_SECONDS:
            # Distinctive marker for log-based alerting: past one coalesce
            # window the stored lastSeen values are genuinely aging, and once
            # they cross heartbeat_grace the stale-run monitor will falsely
            # reap healthy runs.
            logger.critical(
                "HEARTBEAT_WRITES_FAILING failing_for=%ds consecutive=%d — "
                "lastSeen is going stale for all active runs; the stale-run "
                "monitor will falsely reap them once it exceeds heartbeat_grace",
                int(failing_for),
                _heartbeat_write_failures["consecutive"],
            )
        logger.exception("Failed to record heartbeat for run %s", run_id)
        session.rollback()


STALE_RUN_LOCK_ID = 8675309  # arbitrary unique ID for pg_try_advisory_lock


def process_runs(session, ch_client, smtp_config, grace=1800, heartbeat_grace=150):
    # Acquire a Postgres advisory lock so only one instance runs per cycle.
    # pg_try_advisory_xact_lock is non-blocking and auto-releases at transaction end.
    acquired = session.execute(
        text("SELECT pg_try_advisory_xact_lock(:lock_id)"),
        {"lock_id": STALE_RUN_LOCK_ID},
    ).scalar()
    if not acquired:
        logger.info("Another instance holds the lock, skipping this cycle")
        return []

    runs = session.query(Run).filter(Run.status == "RUNNING").all()
    logger.info(f"Found {len(runs)} RUNNING runs")

    if not runs:
        return []

    # Filter runs with valid projects
    valid_runs = [run for run in runs if run.project]
    if len(valid_runs) != len(runs):
        logger.warning(f"Skipping {len(runs) - len(valid_runs)} runs without associated projects")

    # Single batch query for all runs (instead of N individual queries)
    run_ids = [run.id for run in valid_runs]
    last_updates = get_last_update_times(ch_client, run_ids)

    if last_updates is None:
        logger.error("Failed to get last update times from ClickHouse, skipping this cycle")
        return None

    # Primary liveness signal: the SDK heartbeat persisted by /api/runs/trigger.
    # It is a direct, low-latency signal independent of the metric ingest
    # pipeline and of how often the user calls log(), so it carries a much
    # tighter grace than the ClickHouse fallback.
    heartbeats = get_last_heartbeats(session, run_ids)

    if heartbeats is None:
        logger.error("Failed to fetch heartbeats from Postgres, skipping this cycle")
        return None

    # Boot-race guard: if this process just (re)started, heartbeat rows may be
    # stale only because nothing was up to record pings during the preceding
    # outage or deploy (the reaper and the API share a pod via start.sh). Until
    # the process has been up for one full heartbeat_grace — long enough for
    # the API to accept a round of ~4s SDK pings and refresh every live run's
    # row — do not judge heartbeat-tracked runs at all. Fallback-path runs
    # (no heartbeat row) are unaffected: their signals do not depend on this
    # service being up.
    warming_up = (time.monotonic() - _PROCESS_STARTED_AT) < heartbeat_grace

    now_utc = datetime.now(timezone.utc)
    failed_run_ids = []
    skipped_warm_up = 0

    for run in valid_runs:
        last_seen = heartbeats.get(run.id)
        last_metric = last_updates.get(run.id)
        if last_seen is not None and warming_up:
            # Cannot trust heartbeat staleness yet — leave this run un-judged
            # for this cycle. The threshold checks at the bottom of the loop
            # still run.
            skipped_warm_up += 1
        else:
            if last_seen is not None:
                # Heartbeat present → tight, direct liveness check. But do not let a
                # frozen heartbeat (e.g. the ping write failing while training is
                # otherwise healthy and still logging) falsely reap a live run:
                # take the most recent of the heartbeat and the last ClickHouse
                # metric, so a run is only reaped when *both* signals are quiet.
                signal_time = last_seen
                if last_metric is not None and last_metric > signal_time:
                    signal_time = last_metric
                threshold = heartbeat_grace
                reason = "heartbeat-timeout"
            else:
                # No heartbeat on record (older SDK, noop mode, or a run that has
                # not pinged since this shipped): fall back to the last ClickHouse
                # metric, then to updatedAt, on the original (looser) grace.
                signal_time = last_metric
                if signal_time is None:
                    signal_time = run.updatedAt.replace(tzinfo=timezone.utc)
                threshold = grace
                reason = "stale"

            time_diff = now_utc - signal_time
            if timedelta(seconds=threshold) < time_diff < timedelta(days=16384):
                logger.info(
                    f"Marking run {run.id} as FAILED (project={run.project.name}, "
                    f"reason={reason}, last_seen={signal_time.isoformat()}, "
                    f"quiet_for={int(time_diff.total_seconds())}s, threshold={threshold}s)"
                )
                transition_run_status(
                    session,
                    run_id=run.id,
                    to_status="FAILED",
                    source="stale-monitor",
                    metadata={
                        "reason": reason,
                        "grace_seconds": threshold,
                        "stale_for_seconds": int(time_diff.total_seconds()),
                        "last_update_time": signal_time.isoformat(),
                    },
                )
                # Refresh the in-memory ORM copy so downstream code (send_alert)
                # observes the new status without another round-trip.
                run.status = "FAILED"
                send_alert(
                    session,
                    run,
                    smtp_config,
                    signal_time,
                    title="Status Update",
                    body=f"The run may have stalled and requires attention - no activity for over {threshold} seconds",
                    level=NotificationType.RUN_FAILED,
                    email=False,
                )
                failed_run_ids.append(run.id)

        # Check thresholds (still per-run, only for runs with triggers configured)
        if run.loggerSettings and run.loggerSettings.get("trigger"):
            for k, v in run.loggerSettings["trigger"].items():
                if v.get("operator") and isinstance(k, str):
                    check_threshold(
                        session,
                        ch_client,
                        smtp_config,
                        run,
                        log_name=k,
                        threshold=v.get("threshold"),
                        operator=v.get("operator"),
                    )

    if skipped_warm_up:
        logger.info(
            f"Warm-up ({heartbeat_grace}s after process start): left "
            f"{skipped_warm_up} heartbeat-tracked runs un-judged this cycle"
        )

    try:
        session.commit()
        if failed_run_ids:
            logger.info(f"Marked {len(failed_run_ids)} runs as FAILED: {failed_run_ids}")
        else:
            logger.info("No stale runs found")
    except Exception as e:
        logger.exception("Error committing updates")
        session.rollback()

    return failed_run_ids


def get_emails(session, organization_id):
    try:
        members = (
            session.query(User.email)
            .join(Member, Member.userId == User.id)
            .filter(Member.organizationId == organization_id)
            .all()
        )
        emails = [member[0] for member in members]
        return emails
    except Exception as e:
        logger.error(f"Error retrieving organization emails: {e}")
        return []


def check_threshold(
    session, ch_client, smtp_config, run, log_name, threshold, operator=">="
):
    if not (operator in ["<", "<=", ">", ">="] and isinstance(threshold, (int, float))):
        logger.warning(f"Invalid operator: {operator}")
        return False
    project_name = run.project.name

    ch_query = f"""
        SELECT time AS last_update_time, value
        FROM mlop_metrics
        WHERE projectName = %(projectName)s
            AND runId = %(runId)s
            AND tenantId = %(tenantId)s
            AND logName = %(logName)s
            AND value {operator} %(threshold)s
        ORDER BY time DESC
        LIMIT 1
    """

    ch_params = {
        "projectName": project_name,
        "runId": run.id,
        "tenantId": run.organizationId,
        "logName": log_name,
        "threshold": threshold,
    }

    try:
        result = ch_client.query(ch_query, parameters=ch_params)
    except Exception as e:
        logger.error(f"Error querying ClickHouse for run {run.id} threshold check: {e}")
        return None

    if not result.result_rows or result.result_rows[0][0] is None:
        logger.debug(f"No threshold violation found for run {run.id} on {log_name}")
        return None

    last_update_time = result.result_rows[0][0]
    violation_value = result.result_rows[0][1]

    if isinstance(last_update_time, str):
        try:
            last_update_time = datetime.fromisoformat(last_update_time)
        except ValueError as e:
            logger.error(f"Error parsing metric time for run {run.id}: {e}")
            return None

    if last_update_time.tzinfo is None:
        last_update_time = last_update_time.replace(tzinfo=timezone.utc)

    logger.info(
        f"Run {run.id} (Project: {project_name}) {log_name} value {violation_value} {operator} {threshold} at {last_update_time}"
    )

    transition_run_status(
        session,
        run_id=run.id,
        to_status="CANCELLED",
        source="threshold-trigger",
        metadata={
            "reason": "threshold-exceeded",
            "log_name": log_name,
            "operator": operator,
            "threshold": threshold,
            "violation_value": violation_value,
        },
    )
    run.status = RunStatus.CANCELLED  # keep ORM copy fresh for send_alert
    send_alert(
        session,
        run,
        smtp_config,
        last_update_time,
        f"Threshold Exceeded on {log_name}",
        f"Threshold exceeded for {log_name}: {violation_value} {operator} {threshold}",
        NotificationType.RUN_FAILED,
        email=True,
    )

    return True


def check_run_time(session, ch_client, smtp_config, run, grace):
    now_utc = datetime.now(timezone.utc)
    project_name = run.project.name

    ch_query = """
        SELECT MAX(time) AS last_update_time
        FROM mlop_metrics
        WHERE projectName = %(projectName)s
            AND runId = %(runId)s
            AND tenantId = %(tenantId)s
    """
    ch_params = {
        "projectName": project_name,
        "runId": run.id,
        "tenantId": run.organizationId,
    }
    try:
        result = ch_client.query(ch_query, parameters=ch_params)
    except Exception as e:
        logger.error(f"Error querying ClickHouse for run {run.id}: {e}")
        return None

    if not result.result_rows or result.result_rows[0][0] is None:
        logger.debug(f"No metric data for run {run.id}")
        return None

    last_update_time = result.result_rows[0][0]
    if isinstance(last_update_time, str):
        try:
            last_update_time = datetime.fromisoformat(last_update_time)
        except ValueError as e:
            logger.error(f"Error parsing update time for run {run.id}: {e}")
            return None
    if last_update_time.tzinfo is None:
        last_update_time = last_update_time.replace(tzinfo=timezone.utc)

    # for runs with no metrics, use updatedAt time
    if last_update_time == datetime.fromtimestamp(0, timezone.utc) and timedelta(
        seconds=grace
    ) < now_utc - run.updatedAt.replace(tzinfo=timezone.utc):
        last_update_time = run.updatedAt.replace(tzinfo=timezone.utc)

    time_diff = now_utc - last_update_time
    if timedelta(seconds=grace) < time_diff < timedelta(days=16384):
        logger.info(
            f"Run {run.id} (Project: {project_name}) last update at {last_update_time} is older than {grace} seconds"
        )
        transition_run_status(
            session,
            run_id=run.id,
            to_status="FAILED",
            source="stale-monitor",
            metadata={
                "reason": "stale",
                "grace_seconds": grace,
                "stale_for_seconds": int(time_diff.total_seconds()),
                "last_update_time": last_update_time.isoformat(),
            },
        )
        run.status = "FAILED"
        send_alert(
            session,
            run,
            smtp_config,
            last_update_time,
            title="Status Update",
            body=f"The run may have stalled and requires attention - last update exceeded {grace} seconds",
            level=NotificationType.RUN_FAILED,
            email=False,
        )
    else:
        logger.debug(
            f"Run {run.id} (Project: {project_name}) is active. Last update at {last_update_time}"
        )
    return True


def send_alert(
    session, run, smtp_config, last_update_time, title, body, level=NotificationType.INFO, email=True
):
    session.add(
        Notification(
            runId=run.id,
            organizationId=run.organizationId,
            type=level,
            content=f"{title}: {body}",
        )
    )
    if email:
        for e in get_emails(session, run.organizationId):
            send_email(
                smtp_config,
                from_address=smtp_config["from_address"],
                to_address=e,
                subject=f"mlop: {title} for Run {run.name}",
                body=process_run_email(
                    run_name=run.name,
                    project_name=run.project.name,
                    last_update_time=last_update_time.strftime("%Y-%m-%d %H:%M:%S"),
                    time_diff_seconds=int(
                        (datetime.now(timezone.utc) - last_update_time).total_seconds()
                    ),
                    run_url=get_run_url(
                        host=smtp_config["app_host"],
                        organization=run.organization.slug,
                        project=run.project.name,
                        run_id=run.id,
                    ),
                    reason=body,
                ),
                html=True,
            )


def is_api_key_expired(expires_at: datetime | None) -> bool:
    """Return True if the API key's expiry instant has passed.

    ApiKey.expiresAt is a naive TIMESTAMP column, so a value read from the
    database is offset-naive. Comparing it directly against
    datetime.now(timezone.utc) (offset-aware) raises TypeError, so a naive
    expiresAt is interpreted as UTC before the comparison — the same guard
    this module already applies to updatedAt/lastUpdate elsewhere. A null
    expiresAt means the key never expires.
    """
    if expires_at is None:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at < datetime.now(timezone.utc)


def check_api_key(session: Session, authorization: str):
    raw_api_key = authorization.replace("Bearer ", "")
    hashed_key = hash_api_key(raw_api_key)
    if not hashed_key:
        logger.warning("Invalid API key format")
        return False

    api_key_record = session.query(ApiKey).filter(ApiKey.key == hashed_key).first()
    if not api_key_record:
        logger.warning(f"API key not found")
        return False

    if is_api_key_expired(api_key_record.expiresAt):
        logger.warning(f"API key {api_key_record.id} has expired")
        return False

    # api_key_record.lastUsed = datetime.now(timezone.utc)
    return api_key_record


def hash_api_key(api_key):
    if isinstance(api_key, str):
        if api_key.startswith("mlpi_"):
            return api_key
        return hashlib.sha256(api_key.encode()).hexdigest()
    else:
        return None


def check_run(session, runId, authorization):
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401, detail="Authorization header missing or invalid"
        )

    raw_api_key = authorization.replace("Bearer ", "")
    if not raw_api_key:
        raise HTTPException(status_code=401, detail="Invalid API key format")

    api_key_record = check_api_key(session, raw_api_key)
    if not api_key_record:
        raise HTTPException(
            status_code=401, detail="Invalid or expired API key for this run"
        )

    run = (
        session.query(Run)
        .filter(Run.id == runId, Run.organizationId == api_key_record.organizationId)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return run
