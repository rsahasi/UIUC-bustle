# backend/tests/test_share.py
"""Tests for share trip endpoints and repo."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

import main
from src.share.repo import (
    create_shared_trip, get_shared_trip_status, patch_shared_trip, init_share_schema,
)


@pytest.fixture
def share_db(tmp_path):
    db = tmp_path / "app.db"
    init_share_schema(db)
    return db


@pytest.fixture
def client(share_db):
    with patch.object(main, "SHARE_DB_PATH", share_db):
        yield TestClient(main.app)


# ── Schema test ────────────────────────────────────────────────────────────────

def test_shared_trips_table_created(tmp_path):
    """init_share_schema must create the shared_trips table."""
    db = tmp_path / "app.db"
    init_share_schema(db)
    with sqlite3.connect(db) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "shared_trips" in tables


# ── Repo unit tests ────────────────────────────────────────────────────────────

def test_create_and_get_trip(share_db):
    token = create_shared_trip(share_db, "Siebel Center", "22", "Illini", "Green & Wright", "walking", 9999999999)
    assert len(token) == 8
    status = get_shared_trip_status(share_db, token)
    assert status is not None
    assert status["destination"] == "Siebel Center"
    assert status["phase"] == "walking"
    assert status["expired"] is False


def test_patch_phase(share_db):
    token = create_shared_trip(share_db, "Siebel Center", "22", "Illini", "Stop A", "walking", None)
    ok = patch_shared_trip(share_db, token, "on_bus", 9999999999)
    assert ok is True
    status = get_shared_trip_status(share_db, token)
    assert status["phase"] == "on_bus"
    assert status["eta_epoch"] == 9999999999


def test_patch_arrived_soft_expires(share_db):
    token = create_shared_trip(share_db, "Siebel", None, None, None, "on_bus", None)
    patch_shared_trip(share_db, token, "arrived", None)
    status = get_shared_trip_status(share_db, token)
    assert status["expired"] is True


def test_get_nonexistent_token(share_db):
    result = get_shared_trip_status(share_db, "notfound")
    assert result is None


def test_patch_nonexistent_returns_false(share_db):
    ok = patch_shared_trip(share_db, "notfound", "on_bus", None)
    assert ok is False


# ── Endpoint integration tests ─────────────────────────────────────────────────

def test_post_share_trip(client):
    r = client.post("/share/trips", json={
        "destination": "Siebel Center",
        "route_id": "22",
        "route_name": "Illini",
        "stop_name": "Green & Wright",
        "phase": "walking",
        "eta_epoch": 9999999999,
    })
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert len(data["token"]) == 8
    assert "/t/" in data["url"]


def test_post_share_trip_invalid_phase(client):
    r = client.post("/share/trips", json={"destination": "Siebel", "phase": "teleporting"})
    assert r.status_code == 400


def test_patch_share_trip(client):
    token = client.post("/share/trips", json={"destination": "Siebel", "phase": "walking"}).json()["token"]
    r = client.patch(f"/share/trips/{token}", json={"phase": "on_bus"})
    assert r.status_code == 200


def test_patch_expired_returns_404(client):
    r = client.patch("/share/trips/notfound", json={"phase": "on_bus"})
    assert r.status_code == 404


def test_get_status(client):
    token = client.post("/share/trips", json={"destination": "Siebel", "phase": "walking", "eta_epoch": 9999999999}).json()["token"]
    r = client.get(f"/share/trips/{token}/status")
    assert r.status_code == 200
    data = r.json()
    assert data["destination"] == "Siebel"
    assert data["expired"] is False


def test_get_status_unknown_token_returns_expired(client):
    r = client.get("/share/trips/unknownXX/status")
    assert r.status_code == 200
    assert r.json()["expired"] is True


def test_share_page_html(client):
    token = client.post("/share/trips", json={"destination": "Siebel", "phase": "walking"}).json()["token"]
    r = client.get(f"/t/{token}")
    assert r.status_code == 200
    assert "UIUC Bustle" in r.text
    assert token in r.text
