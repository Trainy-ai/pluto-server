"""Browser security headers on every py-service response.

Pentest finding: the service answered with no security headers and a
`Server: uvicorn` banner. The headers are set once by middleware in
server.py (and repeated on the unhandled-error 500, which Starlette builds
outside the middleware stack), and uvicorn is started with
server_header=False.

Run with: pytest tests/test_security_headers.py -v
"""

import os
import runpy
from pathlib import Path

# server.py reads a database URL at import time; create_engine is lazy so a
# dummy sqlite URL is enough to import the module.
os.environ.setdefault("DATABASE_DIRECT_URL", "sqlite://")

import pytest
import server as server_module
import uvicorn
from fastapi.testclient import TestClient

EXPECTED_HEADERS = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
}


def assert_security_headers(response):
    for name, value in EXPECTED_HEADERS.items():
        assert response.headers.get(name) == value, name


@pytest.fixture
def client():
    return TestClient(server_module.app, raise_server_exceptions=False)


def test_healthz_carries_security_headers(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert_security_headers(response)


def test_404_carries_security_headers(client):
    response = client.get("/no-such-route")
    assert response.status_code == 404
    assert_security_headers(response)


def test_http_exception_carries_security_headers(client):
    # Missing bearer token -> HTTPException(401) raised inside the handler.
    response = client.post("/api/runs/trigger", json={"runId": 1})
    assert response.status_code == 401
    assert_security_headers(response)


def test_unhandled_error_500_carries_security_headers(client):
    # The Exception handler runs in Starlette's outermost ServerErrorMiddleware,
    # outside add_security_headers, so it must set the headers itself.
    app = server_module.app
    if not any(getattr(route, "path", None) == "/__test_boom" for route in app.routes):

        @app.get("/__test_boom")
        def boom():
            raise RuntimeError("boom")

    response = client.get("/__test_boom")
    assert response.status_code == 500
    assert_security_headers(response)


def test_uvicorn_started_without_server_header(monkeypatch):
    calls = {}
    monkeypatch.setattr(uvicorn, "run", lambda _app, **kwargs: calls.update(kwargs))
    runpy.run_path(str(Path(__file__).resolve().parents[1] / "server.py"), run_name="__main__")
    assert calls["server_header"] is False
