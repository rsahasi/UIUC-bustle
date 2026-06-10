"""Tests for OptionalAPIKeyMiddleware — key enforcement and exempt paths."""
from fastapi import FastAPI
from starlette.testclient import TestClient

from src.middleware.auth import OptionalAPIKeyMiddleware, get_valid_api_keys


def _make_client(required: bool, keys: str) -> TestClient:
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/protected")
    def protected():
        return {"ok": True}

    app.add_middleware(
        OptionalAPIKeyMiddleware,
        api_key_required=required,
        api_keys=get_valid_api_keys(keys),
    )
    return TestClient(app)


def test_get_valid_api_keys_parsing():
    assert get_valid_api_keys("a, b ,, c") == {"a", "b", "c"}
    assert get_valid_api_keys("") == set()


def test_disabled_allows_all():
    client = _make_client(required=False, keys="secret")
    assert client.get("/protected").status_code == 200


def test_enabled_rejects_missing_key():
    client = _make_client(required=True, keys="secret")
    assert client.get("/protected").status_code == 401


def test_enabled_rejects_wrong_key():
    client = _make_client(required=True, keys="secret")
    assert client.get("/protected", headers={"X-API-Key": "nope"}).status_code == 401


def test_enabled_accepts_valid_key():
    client = _make_client(required=True, keys="secret,other")
    assert client.get("/protected", headers={"X-API-Key": "secret"}).status_code == 200
    assert client.get("/protected", headers={"X-API-Key": "other"}).status_code == 200


def test_health_exempt_even_when_required():
    client = _make_client(required=True, keys="secret")
    assert client.get("/health").status_code == 200
