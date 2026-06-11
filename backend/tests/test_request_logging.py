"""Tests for request-id correlation in RequestLoggingMiddleware."""
import re

from starlette.requests import Request
from starlette.testclient import TestClient

import main
from src.middleware.request_logging import _resolve_request_id


def _req(request_id: str | None) -> Request:
    headers = [(b"x-request-id", request_id.encode())] if request_id is not None else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "query_string": b""})


def test_resolve_generates_when_absent():
    rid = _resolve_request_id(_req(None))
    assert re.fullmatch(r"[0-9a-f]{32}", rid)


def test_resolve_keeps_valid_incoming():
    assert _resolve_request_id(_req("abc-123_DEF")) == "abc-123_DEF"


def test_resolve_rejects_unsafe_incoming():
    # Spaces / injection attempts are discarded in favor of a generated id.
    rid = _resolve_request_id(_req("bad id\nwith spaces"))
    assert re.fullmatch(r"[0-9a-f]{32}", rid)
    # Over-long values are rejected too.
    assert re.fullmatch(r"[0-9a-f]{32}", _resolve_request_id(_req("x" * 100)))


def test_response_includes_request_id_header():
    client = TestClient(main.app)
    r = client.get("/health")
    assert "x-request-id" in {k.lower() for k in r.headers}
    assert r.headers["x-request-id"]


def test_valid_incoming_request_id_is_echoed():
    client = TestClient(main.app)
    r = client.get("/health", headers={"X-Request-ID": "trace-42"})
    assert r.headers["x-request-id"] == "trace-42"
