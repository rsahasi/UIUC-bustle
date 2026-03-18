"""Tests for update_class repo function and PATCH /schedule/classes/{class_id} endpoint."""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.data.buildings_repo import update_class


def make_pool(fetchrow_return=None, execute_return="UPDATE 1"):
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value=fetchrow_return)
    pool.execute = AsyncMock(return_value=execute_return)
    return pool


def make_class_row(overrides=None):
    row = {
        "class_id": "abc-123",
        "user_id": "user-1",
        "title": "CS 101",
        "days_of_week": '["MON","WED"]',
        "start_time_local": "09:00",
        "building_id": "siebel",
        "destination_lat": None,
        "destination_lng": None,
        "destination_name": None,
        "end_time_local": "10:00",
    }
    if overrides:
        row.update(overrides)
    return row


# --- update_class repo unit tests ---

@pytest.mark.asyncio
async def test_update_class_returns_updated_record():
    updated_row = make_class_row({"title": "CS 225"})
    pool = make_pool(fetchrow_return=updated_row)
    result = await update_class(pool, "abc-123", "user-1", {"title": "CS 225"})
    assert result is not None
    assert result.title == "CS 225"
    assert result.class_id == "abc-123"
    pool.fetchrow.assert_awaited_once()
    # Verify the SQL contains UPDATE and RETURNING
    call_args = pool.fetchrow.call_args
    assert "UPDATE" in call_args[0][0]
    assert "RETURNING" in call_args[0][0]


@pytest.mark.asyncio
async def test_update_class_not_found_returns_none():
    pool = make_pool(fetchrow_return=None)
    result = await update_class(pool, "nonexistent", "user-1", {"title": "CS 225"})
    assert result is None


@pytest.mark.asyncio
async def test_update_class_serializes_days_of_week():
    updated_row = make_class_row({"days_of_week": '["MON","FRI"]'})
    pool = make_pool(fetchrow_return=updated_row)
    result = await update_class(pool, "abc-123", "user-1", {"days_of_week": ["MON", "FRI"]})
    assert result is not None
    assert result.days_of_week == ["MON", "FRI"]
    # Verify days_of_week was JSON-serialized before being passed to DB
    call_args = pool.fetchrow.call_args
    params = call_args[0][1:]  # all positional params after the SQL string
    # One of the params should be a JSON string of the days
    assert any(p == '["MON", "FRI"]' for p in params)


@pytest.mark.asyncio
async def test_update_class_empty_updates_fetches_existing():
    existing_row = make_class_row()
    pool = make_pool(fetchrow_return=existing_row)
    result = await update_class(pool, "abc-123", "user-1", {})
    assert result is not None
    assert result.title == "CS 101"
    # Should use fetchrow (SELECT path), not UPDATE path
    pool.fetchrow.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_class_ignores_unknown_fields():
    updated_row = make_class_row({"title": "CS 999"})
    pool = make_pool(fetchrow_return=updated_row)
    # "malicious_field" is not in _UPDATABLE_FIELDS so it should be ignored
    result = await update_class(pool, "abc-123", "user-1", {
        "title": "CS 999",
        "malicious_field": "DROP TABLE schedule_classes;",
    })
    assert result is not None
    # Verify the SQL doesn't contain the unknown field
    call_args = pool.fetchrow.call_args
    assert "malicious_field" not in call_args[0][0]


# --- HTTP-level test via FastAPI TestClient ---

from starlette.testclient import TestClient


def _make_http_pool(fetchrow_return=None):
    """Pool mock suitable for HTTP-level tests (execute must be an AsyncMock for INSERT INTO users)."""
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value=fetchrow_return)
    pool.execute = AsyncMock(return_value="INSERT 0 1")
    return pool


import os


def _http_patches(mock_pool):
    """Context managers needed for HTTP-level endpoint tests."""
    import main as app_module
    return (
        patch.dict(os.environ, {"SUPABASE_JWT_SECRET": "test-secret"}),
        patch.object(app_module, "get_pool", return_value=mock_pool),
        patch("src.auth.jwt.jwt.decode", return_value={"sub": "user-1"}),
    )


def test_patch_endpoint_updates_class():
    updated_row = make_class_row({"title": "Updated Title"})
    mock_pool = _make_http_pool(fetchrow_return=updated_row)

    import main as app_module
    env_patch, pool_patch, jwt_patch = _http_patches(mock_pool)

    with env_patch, pool_patch, jwt_patch:
        client = TestClient(app_module.app, raise_server_exceptions=True)
        resp = client.patch(
            "/schedule/classes/abc-123",
            json={"title": "Updated Title"},
            headers={"Authorization": "Bearer faketoken"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Updated Title"
    assert data["class_id"] == "abc-123"


def test_patch_endpoint_returns_404_when_not_found():
    mock_pool = _make_http_pool(fetchrow_return=None)

    import main as app_module
    env_patch, pool_patch, jwt_patch = _http_patches(mock_pool)

    with env_patch, pool_patch, jwt_patch:
        client = TestClient(app_module.app, raise_server_exceptions=False)
        resp = client.patch(
            "/schedule/classes/nonexistent",
            json={"title": "X"},
            headers={"Authorization": "Bearer faketoken"},
        )
    assert resp.status_code == 404


def test_patch_endpoint_rejects_invalid_days():
    mock_pool = _make_http_pool()

    import main as app_module
    env_patch, pool_patch, jwt_patch = _http_patches(mock_pool)

    with env_patch, pool_patch, jwt_patch:
        client = TestClient(app_module.app, raise_server_exceptions=False)
        resp = client.patch(
            "/schedule/classes/abc-123",
            json={"days_of_week": ["MONDAY"]},  # invalid
            headers={"Authorization": "Bearer faketoken"},
        )
    assert resp.status_code == 422
