"""
Auth tests for the py service's operator and compat endpoints.

The service is served on a public host, and until now these routes accepted
anonymous requests:

  * POST /api/stale-runs/trigger runs one reaper cycle (marks runs FAILED and
    sends alerts). It is now gated behind STALE_RUN_TRIGGER_TOKEN, presented
    as `X-Internal-Token`; with the variable unset the route answers 404 like
    an unknown path, so a disabled trigger is never advertised.
  * POST /api/compat/w/* open outbound sessions to a third-party API with a
    caller-supplied key and download files to local disk. They now require a
    valid mlop API key (`Authorization: Bearer <key>`), validated by the same
    check_api_key the SDK trigger path uses, and the migration routes write
    with that bearer key so a caller can only migrate into their own org.
  * check_api_key, the shared validator behind the SDK routes and the compat
    routes, also rejects revoked keys (non-null revokedAt), matching
    isApiKeyRevoked in web/server/lib/api-key.ts.

Everything that would leave the process (ClickHouse, the third-party API,
process_runs) is stubbed; API keys live in an in-memory SQLite carrying the
real model schema. Run with: pytest tests/test_endpoint_auth.py -vv
"""

import hashlib
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# server.py reads a database URL at import time; create_engine is lazy so a
# dummy sqlite URL is enough to import the module (same as test_db_pool.py).
os.environ.setdefault("DATABASE_DIRECT_URL", "sqlite://")

import server as server_module

TOKEN_ENV = server_module.STALE_RUN_TRIGGER_TOKEN_ENV
STALE_TRIGGER = "/api/stale-runs/trigger"

VALID_KEY = "mlpk_valid_key_for_tests"
EXPIRED_KEY = "mlpk_expired_key_for_tests"
REVOKED_KEY = "mlpk_revoked_key_for_tests"
UNKNOWN_KEY = "mlpk_never_issued"
RUN_ID = 42  # a RUNNING run in the same org as the seeded keys

COMPAT_ROUTES = {
    "/api/compat/w/viewer": {"key": "w-key"},
    "/api/compat/w/list-runs": {"key": "w-key", "entity": "team"},
    "/api/compat/w/migrate-all": {"key": "w-key", "entity": "team"},
    "/api/compat/w/migrate-run": {
        "key": "w-key",
        "entity": "team",
        "project": "proj",
        "run": "run-1",
    },
}


@pytest.fixture
def db_session():
    """In-memory SQLite with the real model schema, seeded with a valid, an
    expired and a revoked hashed API key plus a RUNNING run in their org.
    StaticPool shares the single connection with the threadpool FastAPI runs
    sync handlers on."""
    from python.models import ApiKey, Base, Project, Run

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    sess = Session()

    yesterday = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    sess.add_all(
        [
            ApiKey(
                id="key-valid",
                key=hashlib.sha256(VALID_KEY.encode()).hexdigest(),
                organizationId="org-1",
            ),
            ApiKey(
                id="key-expired",
                key=hashlib.sha256(EXPIRED_KEY.encode()).hexdigest(),
                organizationId="org-1",
                expiresAt=yesterday,
            ),
            ApiKey(
                id="key-revoked",
                key=hashlib.sha256(REVOKED_KEY.encode()).hexdigest(),
                organizationId="org-1",
                expiresAt=None,  # not expired: only revokedAt rejects it
                revokedAt=yesterday,
            ),
            Project(id=1, name="proj"),
            Run(id=RUN_ID, name="run-42", projectId=1, organizationId="org-1", status="RUNNING"),
        ]
    )
    sess.commit()

    yield sess
    sess.close()
    engine.dispose()


@pytest.fixture
def client(db_session):
    server_module.app.dependency_overrides[server_module.get_db] = lambda: db_session
    try:
        yield TestClient(server_module.app, raise_server_exceptions=False)
    finally:
        server_module.app.dependency_overrides.pop(server_module.get_db, None)


@pytest.fixture
def stale_run_stubs(monkeypatch):
    """Keep the stale-run trigger in-process: stub ClickHouse, the DB session
    factory and process_runs. Returns the process_runs mock."""
    process_runs = MagicMock(return_value=[7, 9])
    monkeypatch.setattr(server_module, "process_runs", process_runs)
    monkeypatch.setattr(server_module, "SessionLocal", lambda: MagicMock())
    monkeypatch.setenv("CLICKHOUSE_URL", "http://clickhouse:8123")
    monkeypatch.setattr("clickhouse_connect.get_client", lambda **_kw: MagicMock())
    return process_runs


# ---------------------------------------------------------------------------
# /api/stale-runs/trigger
# ---------------------------------------------------------------------------


def test_stale_trigger_is_404_when_token_unset(monkeypatch, client, stale_run_stubs):
    """No STALE_RUN_TRIGGER_TOKEN means the endpoint does not exist: 404 with
    the same body FastAPI uses for unknown routes, even with a header sent."""
    monkeypatch.delenv(TOKEN_ENV, raising=False)

    resp = client.post(STALE_TRIGGER, headers={"X-Internal-Token": "anything"})

    assert resp.status_code == 404
    assert resp.json() == client.post("/api/no-such-route").json()
    stale_run_stubs.assert_not_called()


def test_stale_trigger_empty_token_env_counts_as_unset(monkeypatch, client, stale_run_stubs):
    """An empty secret must not open the door to an empty header value."""
    monkeypatch.setenv(TOKEN_ENV, "")

    resp = client.post(STALE_TRIGGER, headers={"X-Internal-Token": ""})

    assert resp.status_code == 404
    stale_run_stubs.assert_not_called()


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-Internal-Token": "wrong-token"},
        {"X-Internal-Token": ""},
        {"Authorization": "Bearer correct-token"},  # wrong header, right value
    ],
    ids=["missing", "wrong", "empty", "bearer-instead-of-internal"],
)
def test_stale_trigger_is_401_without_matching_token(monkeypatch, client, stale_run_stubs, headers):
    monkeypatch.setenv(TOKEN_ENV, "correct-token")

    resp = client.post(STALE_TRIGGER, headers=headers)

    assert resp.status_code == 401
    assert "X-Internal-Token" in resp.json()["detail"]
    stale_run_stubs.assert_not_called()


def test_stale_trigger_runs_one_cycle_with_matching_token(monkeypatch, client, stale_run_stubs):
    monkeypatch.setenv(TOKEN_ENV, "correct-token")

    resp = client.post(STALE_TRIGGER, headers={"X-Internal-Token": "correct-token"})

    assert resp.status_code == 200
    assert resp.json() == {
        "processed": 2,
        "marked_failed": [7, 9],
        "grace_seconds": 1800,
    }
    stale_run_stubs.assert_called_once()


# ---------------------------------------------------------------------------
# /api/compat/w/*
# ---------------------------------------------------------------------------


@pytest.fixture
def compat_stubs(monkeypatch):
    """Stub everything the compat routes would send to the network and return
    the mocks, keyed by the name server.py imported them under."""
    w_client = MagicMock()
    w_client.viewer.return_value = {"viewer": {"username": "someone"}}
    stubs = {
        "get_client": MagicMock(return_value=w_client),
        "list_runs": MagicMock(return_value=[{"node": {"name": "proj"}}]),
        "migrate_all": MagicMock(return_value=True),
        "migrate_run_v1": MagicMock(return_value=True),
    }
    for name, mock in stubs.items():
        monkeypatch.setattr(server_module, name, mock)
    stubs["w_client"] = w_client
    return stubs


def _assert_nothing_reached_the_network(stubs):
    for name in ("get_client", "list_runs", "migrate_all", "migrate_run_v1"):
        stubs[name].assert_not_called()


@pytest.mark.parametrize("route", sorted(COMPAT_ROUTES))
def test_compat_route_is_401_without_bearer(client, compat_stubs, route):
    resp = client.post(route, json=COMPAT_ROUTES[route])

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Authorization header missing or invalid"
    _assert_nothing_reached_the_network(compat_stubs)


@pytest.mark.parametrize("route", sorted(COMPAT_ROUTES))
@pytest.mark.parametrize(
    "authorization",
    ["Basic abc", "Bearer ", f"Bearer {UNKNOWN_KEY}", f"Bearer {EXPIRED_KEY}", f"Bearer {REVOKED_KEY}"],
    ids=["not-bearer", "empty-key", "unknown-key", "expired-key", "revoked-key"],
)
def test_compat_route_is_401_with_bad_key(client, compat_stubs, route, authorization):
    resp = client.post(
        route,
        json=COMPAT_ROUTES[route],
        headers={"Authorization": authorization},
    )

    assert resp.status_code == 401
    _assert_nothing_reached_the_network(compat_stubs)


def test_viewer_reaches_handler_with_valid_key(client, compat_stubs):
    resp = client.post(
        "/api/compat/w/viewer",
        json=COMPAT_ROUTES["/api/compat/w/viewer"],
        headers={"Authorization": f"Bearer {VALID_KEY}"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"viewer": {"username": "someone"}}
    compat_stubs["get_client"].assert_called_once_with("w-key", server_module.DOMAIN)


def test_list_runs_reaches_handler_with_valid_key(client, compat_stubs):
    resp = client.post(
        "/api/compat/w/list-runs",
        json=COMPAT_ROUTES["/api/compat/w/list-runs"],
        headers={"Authorization": f"Bearer {VALID_KEY}"},
    )

    assert resp.status_code == 200
    assert resp.json() == [{"node": {"name": "proj"}}]
    compat_stubs["list_runs"].assert_called_once_with(compat_stubs["w_client"], "team")


def test_migrate_all_writes_with_the_bearer_key(client, compat_stubs):
    """The bearer key is the mlop key the migrated runs are written with, so
    the destination is always the caller's own org. A leftover `auth` body
    field from the old contract is ignored rather than honoured."""
    resp = client.post(
        "/api/compat/w/migrate-all",
        json={**COMPAT_ROUTES["/api/compat/w/migrate-all"], "auth": "someone-elses"},
        headers={"Authorization": f"Bearer {VALID_KEY}"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "success"}
    compat_stubs["migrate_all"].assert_called_once_with(VALID_KEY, "w-key", "team", server_module.DOMAIN)


def test_migrate_run_writes_with_the_bearer_key(client, compat_stubs):
    resp = client.post(
        "/api/compat/w/migrate-run",
        json={**COMPAT_ROUTES["/api/compat/w/migrate-run"], "auth": "someone-elses"},
        headers={"Authorization": f"Bearer {VALID_KEY}"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "success"}
    compat_stubs["migrate_run_v1"].assert_called_once_with(VALID_KEY, compat_stubs["w_client"], "team", "proj", "run-1")


def test_migrate_failure_still_surfaces_as_500(client, compat_stubs):
    """Auth must not change the existing failure contract of the migration."""
    compat_stubs["migrate_all"].return_value = None

    resp = client.post(
        "/api/compat/w/migrate-all",
        json=COMPAT_ROUTES["/api/compat/w/migrate-all"],
        headers={"Authorization": f"Bearer {VALID_KEY}"},
    )

    assert resp.status_code == 500
    assert resp.json()["detail"] == "Failed to migrate runs"


# ---------------------------------------------------------------------------
# API key revocation: enforced in check_api_key, the shared path behind the
# SDK routes (check_run) and the compat routes (require_api_key)
# ---------------------------------------------------------------------------


def test_compat_route_rejects_revoked_key(client, compat_stubs):
    resp = client.post(
        "/api/compat/w/viewer",
        json=COMPAT_ROUTES["/api/compat/w/viewer"],
        headers={"Authorization": f"Bearer {REVOKED_KEY}"},
    )

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired API key"
    _assert_nothing_reached_the_network(compat_stubs)


def test_runs_trigger_rejects_revoked_key(client):
    """The SDK cancel-trigger poll must not authenticate a revoked key either,
    even though the key is unexpired and the run belongs to its org."""
    resp = client.post(
        "/api/runs/trigger",
        json={"runId": RUN_ID},
        headers={"Authorization": f"Bearer {REVOKED_KEY}"},
    )

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired API key for this run"


def test_runs_trigger_accepts_key_with_null_revoked_at(client):
    """A live key (revokedAt null, no expiry) still reaches the run: the
    revocation check must not reject the common case."""
    resp = client.post(
        "/api/runs/trigger",
        json={"runId": RUN_ID},
        headers={"Authorization": f"Bearer {VALID_KEY}"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "RUNNING"
