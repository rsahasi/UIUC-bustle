"""Unit tests for src.auth.jwt — no real Supabase connection needed.

Note: these tests deliberately do NOT call importlib.reload(). get_current_user
calls get_settings() at request time (see its docstring), so monkeypatch.setenv
alone is sufficient. Reloading the module rebinds get_current_user to a new
function object, which silently breaks any app.dependency_overrides keyed on
the original — that produced a cross-file test failure in test_recommendation.py
that only appeared when these files ran together.
"""
import jwt as pyjwt
import pytest
from unittest.mock import patch
from fastapi import HTTPException
from starlette.requests import Request

from src.auth.jwt import get_current_user

SECRET = "test-secret"


def _make_request(authorization: str = "") -> Request:
    """Build a minimal Starlette Request with the given Authorization header."""
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"authorization", authorization.encode())] if authorization else [],
        "query_string": b"",
    }
    return Request(scope)


def _encode(payload: dict, secret: str = SECRET, algorithm: str = "HS256") -> str:
    return pyjwt.encode(payload, secret, algorithm=algorithm)


class TestGetCurrentUser:
    def test_missing_secret_raises_503(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", "")
        req = _make_request("Bearer sometoken")
        with pytest.raises(HTTPException) as exc:
            get_current_user(req)
        assert exc.value.status_code == 503
        assert "Auth not configured" in exc.value.detail

    def test_missing_authorization_header_raises_401(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        req = _make_request()  # no Authorization header
        with pytest.raises(HTTPException) as exc:
            get_current_user(req)
        assert exc.value.status_code == 401
        assert "Missing authentication token" in exc.value.detail

    def test_valid_token_returns_user_id(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        token = _encode({"sub": "user-uuid-123", "aud": "authenticated"})
        assert get_current_user(_make_request(f"Bearer {token}")) == "user-uuid-123"

    def test_expired_token_raises_401(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        with patch("src.auth.jwt.jwt.decode") as mock_decode:
            mock_decode.side_effect = pyjwt.ExpiredSignatureError("expired")
            with pytest.raises(HTTPException) as exc:
                get_current_user(_make_request("Bearer expiredtoken"))
        assert exc.value.status_code == 401
        assert "Token expired" in exc.value.detail

    def test_invalid_token_raises_401(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        with patch("src.auth.jwt.jwt.decode") as mock_decode:
            mock_decode.side_effect = pyjwt.InvalidTokenError("bad token")
            with pytest.raises(HTTPException) as exc:
                get_current_user(_make_request("Bearer badtoken"))
        assert exc.value.status_code == 401
        assert "Invalid token" in exc.value.detail


class TestSignatureVerification:
    """Exercise the real jwt.decode call.

    Every test above that mocks jwt.decode would still pass if verification were
    disabled entirely, so these assert the security-critical decode arguments —
    algorithm pinning, signature checking, and audience — actually take effect.
    """

    def test_rejects_token_signed_with_wrong_key(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        token = _encode({"sub": "u1", "aud": "authenticated"}, secret="wrong-secret")
        with pytest.raises(HTTPException) as exc:
            get_current_user(_make_request(f"Bearer {token}"))
        assert exc.value.status_code == 401

    def test_rejects_alg_none_token(self, monkeypatch):
        """An unsigned token must never be accepted (algorithm confusion)."""
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        token = pyjwt.encode({"sub": "u1", "aud": "authenticated"}, None, algorithm="none")
        with pytest.raises(HTTPException) as exc:
            get_current_user(_make_request(f"Bearer {token}"))
        assert exc.value.status_code == 401

    def test_rejects_wrong_audience(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        token = _encode({"sub": "u1", "aud": "anon"})
        with pytest.raises(HTTPException) as exc:
            get_current_user(_make_request(f"Bearer {token}"))
        assert exc.value.status_code == 401

    def test_rejects_genuinely_expired_token(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        token = _encode({"sub": "u1", "aud": "authenticated", "exp": 1_000_000_000})
        with pytest.raises(HTTPException) as exc:
            get_current_user(_make_request(f"Bearer {token}"))
        assert exc.value.status_code == 401
        assert "Token expired" in exc.value.detail

    def test_rejects_token_without_sub(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
        token = _encode({"aud": "authenticated"})
        with pytest.raises(HTTPException) as exc:
            get_current_user(_make_request(f"Bearer {token}"))
        assert exc.value.status_code == 401
        assert "Invalid token" in exc.value.detail
