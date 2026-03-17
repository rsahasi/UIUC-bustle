"""Unit tests for src.auth.jwt — no real Supabase connection needed."""
import pytest
from unittest.mock import patch
from fastapi import HTTPException
from starlette.testclient import TestClient
from starlette.requests import Request
from starlette.datastructures import Headers


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


class TestGetCurrentUser:
    def test_missing_secret_raises_503(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", "")
        import importlib, src.auth.jwt
        importlib.reload(src.auth.jwt)
        from src.auth.jwt import get_current_user
        req = _make_request("Bearer sometoken")
        with pytest.raises(HTTPException) as exc:
            get_current_user(req)
        assert exc.value.status_code == 503
        assert "Auth not configured" in exc.value.detail

    def test_missing_authorization_header_raises_401(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
        from src.auth import jwt as jwt_module
        import importlib; importlib.reload(jwt_module)
        req = _make_request()  # no Authorization header
        with pytest.raises(HTTPException) as exc:
            jwt_module.get_current_user(req)
        assert exc.value.status_code == 401
        assert "Missing authentication token" in exc.value.detail

    def test_valid_token_returns_user_id(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
        # Reload BEFORE patching — reload inside the patch context manager would un-patch.
        from src.auth import jwt as jwt_module
        import importlib; importlib.reload(jwt_module)
        with patch("src.auth.jwt.jwt.decode") as mock_decode:
            mock_decode.return_value = {"sub": "user-uuid-123"}
            req = _make_request("Bearer validtoken")
            result = jwt_module.get_current_user(req)
        assert result == "user-uuid-123"

    def test_expired_token_raises_401(self, monkeypatch):
        import jwt as pyjwt
        monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
        from src.auth import jwt as jwt_module
        import importlib; importlib.reload(jwt_module)
        with patch("src.auth.jwt.jwt.decode") as mock_decode:
            mock_decode.side_effect = pyjwt.ExpiredSignatureError("expired")
            req = _make_request("Bearer expiredtoken")
            with pytest.raises(HTTPException) as exc:
                jwt_module.get_current_user(req)
        assert exc.value.status_code == 401
        assert "Token expired" in exc.value.detail

    def test_invalid_token_raises_401(self, monkeypatch):
        import jwt as pyjwt
        monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
        from src.auth import jwt as jwt_module
        import importlib; importlib.reload(jwt_module)
        with patch("src.auth.jwt.jwt.decode") as mock_decode:
            mock_decode.side_effect = pyjwt.InvalidTokenError("bad token")
            req = _make_request("Bearer badtoken")
            with pytest.raises(HTTPException) as exc:
                jwt_module.get_current_user(req)
        assert exc.value.status_code == 401
        assert "Invalid token" in exc.value.detail
