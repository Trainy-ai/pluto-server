import os
from datetime import datetime, timezone
from typing import Union

from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, Header, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from compat.migrate import get_client, list_runs, migrate_all, migrate_run_v1
from python.env import get_database_url, get_smtp_config
from python.models import Run, RunStatus, RunTriggers, RunTriggerType
from python.server import check_run, send_alert, check_api_key

load_dotenv()

SMTP_CONFIG = get_smtp_config()
DATABASE_URL = get_database_url()
DOMAIN = os.getenv("W_DOMAIN", "localhost")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

app = FastAPI()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


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
async def get_run_triggers(
    runId: int = Body(..., embed=True),
    session: Session = Depends(get_db),
    authorization: str = Header(None),
):
    api_key_record = check_api_key(session, authorization)
    if api_key_record:
        run = check_run(session, runId, authorization)
    else:
        return HTTPException(status_code=401, detail="Invalid API token")

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
async def set_run_alerts(
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


@app.post("/api/compat/w/viewer")  # TODO: protect
async def _viewer(key: str = Body(..., embed=True)):
    c = get_client(key, DOMAIN)
    return c.viewer()


@app.post("/api/compat/w/list-runs")
async def _list_runs(
    auth: str = Body(..., embed=True),
    key: str = Body(..., embed=True),
    entity: str = Body(..., embed=True),
):
    c = get_client(key, DOMAIN)
    return list_runs(c, entity)


@app.post("/api/compat/w/migrate-all")
async def _migrate_all(
    auth: str = Body(..., embed=True),
    key: str = Body(..., embed=True),
    entity: str = Body(..., embed=True),
):
    if migrate_all(auth, key, entity, DOMAIN):
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to migrate runs")


@app.post("/api/compat/w/migrate-run")
async def _migrate_run(
    auth: str = Body(..., embed=True),
    key: str = Body(..., embed=True),
    entity: str = Body(..., embed=True),
    project: str = Body(..., embed=True),
    run: str = Body(..., embed=True),
):
    c = get_client(key, DOMAIN)
    if migrate_run_v1(auth, c, entity, project, run):
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to migrate run")


if __name__ == "__main__":
    import uvicorn
    offset = int(os.getenv("PORT_OFFSET", "0"))
    port = int(os.getenv("PORT", str(3004 + offset)))
    uvicorn.run(app, host="0.0.0.0", port=port)
