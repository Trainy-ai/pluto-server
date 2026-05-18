"""Tests for the global unhandled-exception handler in server.py.

Verifies that uncaught exceptions are logged with request context (method,
path, query, exception type, full traceback) and return a clean JSON 500,
while intentional HTTPExceptions still pass through with their own status.
"""

import logging
import os

import pytest

# server.py requires a database URL at import time (read from DATABASE_DIRECT_URL).
# create_engine() is lazy and does not connect, so a dummy sqlite URL is enough.
os.environ.setdefault("DATABASE_DIRECT_URL", "sqlite://")

from fastapi import HTTPException
from fastapi.testclient import TestClient

import server as server_module

app = server_module.app


@app.get("/_test/boom")
async def _boom():
    raise ValueError("synthetic failure for tests")


@app.get("/_test/http-error")
async def _http_error():
    raise HTTPException(status_code=418, detail="teapot")


client = TestClient(app, raise_server_exceptions=False)


def test_unhandled_exception_returns_clean_500():
    response = client.get("/_test/boom")
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal Server Error"}


def test_unhandled_exception_is_logged_with_context(caplog):
    with caplog.at_level(logging.ERROR, logger="py-server"):
        client.get("/_test/boom?foo=bar")

    records = [r for r in caplog.records if r.name == "py-server"]
    assert records, "expected an error log from the py-server logger"
    record = records[-1]
    message = record.getMessage()
    assert "GET" in message
    assert "/_test/boom" in message
    assert "foo=bar" in message
    # logger.exception attaches the exception so aggregators can group it.
    assert record.exc_info is not None
    assert record.exc_info[0] is ValueError
    assert "synthetic failure for tests" in str(record.exc_info[1])


def test_http_exception_passes_through(caplog):
    """Intentional HTTPExceptions keep their status and are not swallowed."""
    with caplog.at_level(logging.ERROR, logger="py-server"):
        response = client.get("/_test/http-error")

    assert response.status_code == 418
    assert response.json() == {"detail": "teapot"}
    # The catch-all handler must not fire for a normal HTTPException.
    assert not [r for r in caplog.records if r.name == "py-server"]


def test_healthz_still_works():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
