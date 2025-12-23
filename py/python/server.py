import hashlib
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from python.emails import send_email
from python.models import (
    ApiKey,
    Member,
    Notification,
    Organization,
    Run,
    RunStatus,
    User,
)
from python.templates import process_run_email
from python.utils import get_run_url


def process_runs(session, ch_client, smtp_config, grace=120):
    runs = session.query(Run).filter(Run.status == "RUNNING").all()
    print(f"Processing {len(runs)} runs")
    for run in runs:
        if not run.project:
            print(f"Run {run.id} has no associated project.")
            continue
        check_run_time(session, ch_client, smtp_config, run, grace)
        if run.loggerSettings.get("trigger"):  # TODO: clean before parsing
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

    session.commit()
    print("All updates saved to the database.")


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
        print(f"Error retrieving organization emails: {e}")
        return []


def check_threshold(
    session, ch_client, smtp_config, run, log_name, threshold, operator=">="
):
    if not (operator in ["<", "<=", ">", ">="] and isinstance(threshold, (int, float))):
        print(f"Invalid operator: {operator}")
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
        print(f"Error querying ClickHouse for run {run.id} threshold check: {e}")
        return None

    if not result.result_rows or result.result_rows[0][0] is None:
        print(f"No threshold violation found for run {run.id} on {log_name}.")
        return None

    last_update_time = result.result_rows[0][0]
    violation_value = result.result_rows[0][1]

    if isinstance(last_update_time, str):
        try:
            last_update_time = datetime.fromisoformat(last_update_time)
        except ValueError as e:
            print(f"Error parsing metric time for run {run.id}: {e}")
            return None

    if last_update_time.tzinfo is None:
        last_update_time = last_update_time.replace(tzinfo=timezone.utc)

    print(
        f"Run {run.id} (Project: {project_name}) {log_name} value {violation_value} {operator} {threshold} at {last_update_time}."
    )

    run.status = RunStatus.CANCELLED  # run.status = "FAILED"
    send_alert(
        session,
        run,
        smtp_config,
        last_update_time,
        f"Threshold Exceeded on {log_name}",
        f"Threshold exceeded for {log_name}: {violation_value} {operator} {threshold}",
        "RUN_FAILED",
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
        print(f"Error querying ClickHouse for run {run.id}: {e}")
        return None

    if not result.result_rows or result.result_rows[0][0] is None:
        print(f"No metric data for run {run.id}.")
        return None

    last_update_time = result.result_rows[0][0]
    if isinstance(last_update_time, str):
        try:
            last_update_time = datetime.fromisoformat(last_update_time)
        except ValueError as e:
            print(f"Error parsing update time for run {run.id}: {e}")
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
        print(
            f"Run {run.id} (Project: {project_name}) last update at {last_update_time} is older than {grace} seconds."
        )
        run.status = "FAILED"
        send_alert(
            session,
            run,
            smtp_config,
            last_update_time,
            title="Status Update",
            body=f"The run may have stalled and requires attention - last update exceeded {grace} seconds",
            level="RUN_FAILED",
            email=False,
        )
    else:
        print(
            f"Run {run.id} (Project: {project_name}) is active. Last update at {last_update_time}."
        )
    return True


def send_alert(
    session, run, smtp_config, last_update_time, title, body, level="INFO", email=True
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


def check_api_key(session: Session, authorization: str):
    raw_api_key = authorization.replace("Bearer ", "")
    hashed_key = hash_api_key(raw_api_key)
    if not hashed_key:
        print("Invalid API key format")
        return False

    api_key_record = session.query(ApiKey).filter(ApiKey.key == hashed_key).first()
    if not api_key_record:
        print(f"API key {raw_api_key} not found in {os.getenv("DATABASE_URL")}")
        return False

    if api_key_record.expiresAt and api_key_record.expiresAt < datetime.now(
        timezone.utc
    ):
        print(f"API key {api_key_record.id} has expired.")
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
