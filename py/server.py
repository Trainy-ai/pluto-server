import hmac
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Union

from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from compat.migrate import get_client, list_runs, migrate_all, migrate_run_v1
from python.env import get_database_url, get_smtp_config
from python.models import Run, RunStatus, RunTriggers, RunTriggerType
from python.server import (
    check_run,
    heartbeat_write_status,
    process_runs,
    record_heartbeat,
    require_api_key,
    send_alert,
)

load_dotenv()

# Log to stdout so k8s/prod log collectors capture it.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("py-server")

SMTP_CONFIG = get_smtp_config()
DATABASE_URL = get_database_url()
DOMAIN = os.getenv("W_DOMAIN", "localhost")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set")
# Shared secret for the manual stale-run trigger (see require_stale_run_trigger_token).
STALE_RUN_TRIGGER_TOKEN_ENV = "STALE_RUN_TRIGGER_TOKEN"


def build_engine(database_url: str):
    """Create the SQLAlchemy engine with an explicitly sized connection pool.

    The default pool (size 5 + overflow 10 = 15 per process) is too small for
    the high-concurrency /api/runs/trigger endpoint, which every active SDK run
    polls for cancel triggers. Under load a single replica exhausted its pool
    and requests timed out with QueuePool TimeoutError.

    Sizing: 20 base + 20 overflow = 40 per pod. With 3 replicas that is 120
    connections, well under RDS Postgres max_connections (~400+ on db.t4g.*).
    pool_pre_ping discards connections silently reaped by RDS/k8s instead of
    surfacing them as errors; pool_recycle keeps long-lived connections fresh.

    sqlite (tests/local) uses its own pool implementation that does not accept
    these QueuePool-only kwargs, so they are applied for real DB URLs only.
    """
    kwargs = {}
    if database_url and database_url.startswith("sqlite"):
        # Sync handlers run in FastAPI's threadpool, so a sqlite connection may
        # be reused across threads (local/test only). Allow that.
        kwargs = {"connect_args": {"check_same_thread": False}}
    elif database_url:
        kwargs = {
            "pool_size": 20,
            "max_overflow": 20,
            "pool_pre_ping": True,
            "pool_recycle": 1800,
        }
    return create_engine(database_url, **kwargs)


engine = build_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

app = FastAPI()

# Browser security headers on every response. This service only ever returns
# JSON, so the strictest CSP costs nothing. Set centrally here, and repeated
# on the 500 handler below, which Starlette runs outside the middleware
# stack.
SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Log uncaught exceptions with request context and a full traceback.

    Starlette's default 500 handler emits a framework-heavy, often-truncated
    trace with no indication of which endpoint failed. logger.exception()
    attaches exc_info so log aggregators can group errors correctly.
    """
    logger.exception(
        "Unhandled exception on %s %s",
        request.method,
        request.url,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
        headers=SECURITY_HEADERS,
    )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/healthz")
async def healthz():
    # heartbeatWrites reports whether record_heartbeat (best-effort, errors
    # swallowed on the request path) is silently failing. Kept as a 200 with a
    # payload rather than a failing status code: restarting the pod would not
    # fix a DB-side issue and would take the trigger endpoint down with it.
    # External monitors should alert when `failing` is true for more than
    # about a minute (see heartbeat_write_status docstring).
    return {"status": "ok", "heartbeatWrites": heartbeat_write_status()}


@app.get("/version")
async def version():
    return {
        "service": "py",
        "version": os.getenv("SERVICE_VERSION", "unknown"),
        "gitCommit": os.getenv("GIT_COMMIT", "unknown"),
        "gitBranch": os.getenv("GIT_BRANCH", "unknown"),
        "buildTime": os.getenv("BUILD_TIME", "unknown"),
    }


@app.post("/api/runs/trigger")
def get_run_triggers(
    runId: int = Body(..., embed=True),
    session: Session = Depends(get_db),
    authorization: str = Header(None),
):
    # check_run validates the API key (raising 401 for a missing/invalid token)
    # and loads the run, so no separate check_api_key call is needed here.
    run = check_run(session, runId, authorization)

    # Record liveness on every poll. This is the signal the stale-run monitor
    # uses to reap dead runs quickly (see process_runs). Coalesced + best-effort.
    record_heartbeat(session, runId)

    if not run.status == RunStatus.CANCELLED:
        triggers = session.query(RunTriggers).filter(
            RunTriggers.runId == runId).all()
        for trigger in triggers:
            if trigger.triggerType == RunTriggerType.CANCEL:
                run.status = RunStatus.CANCELLED
                run.statusUpdated = datetime.now(timezone.utc)
                session.commit()
                session.refresh(run)

    return {
        "status": run.status,
        "triggers": [
            {
                "trigger": trigger.trigger,
            }
            for trigger in triggers
        ]
        if (False and triggers is not None)
        else None,
    }


@app.post("/api/runs/alert")
def set_run_alerts(
    runId: int = Body(..., embed=True),
    alert: dict[str, Union[str, int, bool, None]] = Body(..., embed=True),
    session: Session = Depends(get_db),
    authorization: str = Header(None),
):
    run = check_run(session, runId, authorization)

    if not isinstance(alert, dict):  # TODO: add more checks
        raise HTTPException(status_code=400, detail="Invalid alert")

    try:
        send_alert(
            session,
            run,
            SMTP_CONFIG,
            last_update_time=datetime.fromtimestamp(
                alert.get("timestamp") / 1000, tz=timezone.utc
            )
            if alert.get("timestamp")
            else datetime.now(timezone.utc),
            title=alert.get("title", "Status Update"),
            body=alert.get("body", "alert"),
            level=alert.get("level", "INFO"),
            email=alert.get("email", True),
        )

        if alert.get("url"):
            # TODO: add webhook support
            raise HTTPException(status_code=302, detail=alert.get("url"))
        else:
            return {"status": "success"}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to send alert: {e}")


def require_stale_run_trigger_token(x_internal_token):
    """Gate the manual stale-run trigger behind a shared secret.

    This service is served on a public host and one trigger cycle marks runs
    FAILED and sends alerts, so it must not be callable anonymously. The token
    is read per request, like the ClickHouse settings in the handler below.
    With STALE_RUN_TRIGGER_TOKEN unset (or empty) the endpoint is disabled and
    answers 404 exactly like an unknown route, so it is never advertised; the
    scheduled loop in main.py is unaffected either way.
    """
    expected = os.getenv(STALE_RUN_TRIGGER_TOKEN_ENV)
    if not expected:
        raise HTTPException(status_code=404, detail="Not Found")
    if x_internal_token is None or not hmac.compare_digest(x_internal_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="X-Internal-Token header missing or invalid")


@app.post("/api/stale-runs/trigger")
def trigger_stale_run_check(x_internal_token: str = Header(None)):
    """Manually trigger one cycle of the stale run job.

    Requires `X-Internal-Token: <STALE_RUN_TRIGGER_TOKEN>`; 404 when the
    token is not configured, 401 when it does not match.
    """
    require_stale_run_trigger_token(x_internal_token)

    from clickhouse_connect import get_client as get_clickhouse_client

    ch_url = os.getenv("CLICKHOUSE_URL", "")
    ch_user = os.getenv("CLICKHOUSE_USER", "default")
    ch_password = os.getenv("CLICKHOUSE_PASSWORD", "")

    try:
        ch_host = ch_url.split("://")[1].split(":")[0]
        ch_port = ch_url.split("://")[1].split(":")[1]
    except (IndexError, AttributeError):
        raise HTTPException(status_code=500, detail="CLICKHOUSE_URL not configured")

    ch_client = get_clickhouse_client(
        host=ch_host, port=ch_port, username=ch_user, password=ch_password
    )

    session = SessionLocal()
    try:
        failed_ids = process_runs(session, ch_client, smtp_config=SMTP_CONFIG)
        return {
            "processed": len(failed_ids) if failed_ids is not None else 0,
            "marked_failed": failed_ids or [],
            "grace_seconds": 1800,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stale run check failed: {e}")
    finally:
        session.close()


# The compat routes open outbound sessions to api.{W_DOMAIN} with a caller
# supplied third-party key and download files to local disk, so they require a
# valid mlop API key (Authorization: Bearer <key>). The migration routes write
# the migrated runs with that same bearer key, which pins the destination to
# the org the caller's key belongs to; the former `auth` body field is gone.
# Plain `def` (not async): require_api_key is a synchronous DB call, so these
# must run in the threadpool like the other DB-touching handlers.
def bearer_token(authorization: str) -> str:
    """Raw mlop credential from an Authorization header validated by require_api_key."""
    return authorization.replace("Bearer ", "")


@app.post("/api/compat/w/viewer")
def _viewer(
    key: str = Body(..., embed=True),
    session: Session = Depends(get_db),
    authorization: str = Header(None),
):
    require_api_key(session, authorization)
    c = get_client(key, DOMAIN)
    return c.viewer()


@app.post("/api/compat/w/list-runs")
def _list_runs(
    key: str = Body(..., embed=True),
    entity: str = Body(..., embed=True),
    session: Session = Depends(get_db),
    authorization: str = Header(None),
):
    require_api_key(session, authorization)
    c = get_client(key, DOMAIN)
    return list_runs(c, entity)


@app.post("/api/compat/w/migrate-all")
def _migrate_all(
    key: str = Body(..., embed=True),
    entity: str = Body(..., embed=True),
    session: Session = Depends(get_db),
    authorization: str = Header(None),
):
    require_api_key(session, authorization)
    if migrate_all(bearer_token(authorization), key, entity, DOMAIN):
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to migrate runs")


@app.post("/api/compat/w/migrate-run")
def _migrate_run(
    key: str = Body(..., embed=True),
    entity: str = Body(..., embed=True),
    project: str = Body(..., embed=True),
    run: str = Body(..., embed=True),
    session: Session = Depends(get_db),
    authorization: str = Header(None),
):
    require_api_key(session, authorization)
    c = get_client(key, DOMAIN)
    if migrate_run_v1(bearer_token(authorization), c, entity, project, run):
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to migrate run")


if __name__ == "__main__":
    import uvicorn
    offset = int(os.getenv("PORT_OFFSET", "0"))
    port = int(os.getenv("PORT", str(3004 + offset)))
    # server_header=False: do not announce the server software (Server: uvicorn).
    uvicorn.run(app, host="0.0.0.0", port=port, server_header=False)
