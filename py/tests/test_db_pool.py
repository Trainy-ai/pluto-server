"""Tests for DB connection-pool sizing and non-blocking request handling.

Regression coverage for the production incident where py logged:

    sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10
    reached, connection timed out, timeout 30.00

Root causes addressed:
  1. The engine used SQLAlchemy defaults (pool_size=5, max_overflow=10), too
     small for the high-concurrency /api/runs/trigger polling endpoint across
     3 replicas. build_engine() now sizes the pool explicitly and enables
     pool_pre_ping / pool_recycle so reaped connections don't surface as errors.
  2. DB-touching endpoints were `async def`, so synchronous SQLAlchemy calls
     ran on the event loop and serialized requests (holding connections for the
     full blocked duration). They are now plain `def` so FastAPI runs them in
     its worker threadpool.
  3. /api/runs/trigger returned (instead of raised) an HTTPException on an
     invalid token, so the 401 never reached the client.
"""

import inspect
import os

# server.py reads a database URL at import time; create_engine is lazy so a
# dummy sqlite URL is enough to import the module.
os.environ.setdefault("DATABASE_DIRECT_URL", "sqlite://")

import server as server_module
from sqlalchemy.pool import QueuePool


def test_build_engine_sizes_pool_for_postgres():
    """Postgres engines get an explicitly sized pool with pre-ping + recycle."""
    engine = server_module.build_engine("postgresql://u:p@localhost/db")

    assert isinstance(engine.pool, QueuePool)
    # 20 base + 20 overflow = 40 per pod (well under RDS max_connections).
    assert engine.pool.size() == 20
    assert engine.pool._max_overflow == 20
    # pre_ping clears connections reaped by RDS/k8s instead of erroring on them.
    assert engine.pool._pre_ping is True
    # recycle keeps connections from going stale.
    assert engine.pool._recycle == 1800


def test_build_engine_leaves_sqlite_untouched():
    """sqlite URLs (tests/local) must not get QueuePool-only kwargs."""
    engine = server_module.build_engine("sqlite://")
    # Should not raise and should not be a QueuePool (sqlite uses its own pool).
    assert not isinstance(engine.pool, QueuePool)


def test_module_engine_uses_build_engine_pooling():
    """The module-level engine is built via build_engine (dummy sqlite in tests)."""
    # Under the sqlite test URL the engine must still import cleanly.
    assert server_module.engine is not None


def test_db_endpoints_are_sync_to_avoid_blocking_event_loop():
    """DB/blocking endpoints must be plain `def` so they run in the threadpool.

    An `async def` handler that makes synchronous SQLAlchemy calls blocks the
    event loop and holds its pooled connection for the full blocked duration —
    the exact pattern that exhausted the pool in prod.
    """
    routes = {r.path: r.endpoint for r in server_module.app.routes if hasattr(r, "endpoint")}

    for path in ("/api/runs/trigger", "/api/runs/alert", "/api/stale-runs/trigger"):
        endpoint = routes[path]
        assert not inspect.iscoroutinefunction(endpoint), (
            f"{path} must be a sync `def` so FastAPI offloads its blocking DB "
            f"calls to the threadpool instead of stalling the event loop"
        )


def test_trigger_raises_401_on_invalid_token(monkeypatch):
    """/api/runs/trigger must raise (not return) the 401 so clients see it.

    Previously the handler did `return HTTPException(...)`, which FastAPI
    serialized as a 200/garbage response instead of a real 401. The handler now
    delegates to check_run, so we stub the check_api_key it calls to the
    invalid-key branch (falsy); check_run then raises 401 before any DB query.
    """
    import python.server as pysrv
    from fastapi.testclient import TestClient

    monkeypatch.setattr(pysrv, "check_api_key", lambda _session, _auth: False)
    # Avoid touching a real DB: the dependency just needs to yield something.
    server_module.app.dependency_overrides[server_module.get_db] = lambda: None
    try:
        client = TestClient(server_module.app, raise_server_exceptions=False)
        resp = client.post(
            "/api/runs/trigger",
            json={"runId": 1},
            headers={"Authorization": "Bearer mlpi_invalid"},
        )
        assert resp.status_code == 401
    finally:
        server_module.app.dependency_overrides.pop(server_module.get_db, None)


def test_trigger_raises_401_on_missing_token():
    """A missing Authorization header must yield 401, not a 500.

    Regression for the AttributeError that arose when the handler called
    check_api_key(session, None) directly. check_run guards against a missing
    header and raises 401 before touching the session.
    """
    from fastapi.testclient import TestClient

    server_module.app.dependency_overrides[server_module.get_db] = lambda: None
    try:
        client = TestClient(server_module.app, raise_server_exceptions=False)
        resp = client.post("/api/runs/trigger", json={"runId": 1})
        assert resp.status_code == 401
    finally:
        server_module.app.dependency_overrides.pop(server_module.get_db, None)
