"""Tests for buildings and schedule/classes: CRUD and validation."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
from src.data.buildings_repo import create_class, init_app_db

# Backend root for path setup
BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture
def app_db(tmp_path):
    """Temporary app DB with one building for schedule tests."""
    db = tmp_path / "app.db"
    init_app_db(db)
    import sqlite3
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO buildings (building_id, name, lat, lng) VALUES (?, ?, ?, ?)",
            ("test_bldg", "Test Building", 40.1, -88.2),
        )
        conn.commit()
    return db


@pytest.fixture
def client(app_db):
    """TestClient with app DB overridden to temp DB."""
    main.APP_DB = app_db
    return TestClient(main.app)


def test_get_buildings_empty(tmp_path):
    main.APP_DB = tmp_path / "empty.db"
    init_app_db(main.APP_DB)
    client = TestClient(main.app)
    r = client.get("/buildings")
    assert r.status_code == 200
    data = r.json()
    assert "buildings" in data
    # init_app_db now seeds the "custom" pseudo-building; filter it out for this assertion
    real_buildings = [b for b in data["buildings"] if b["building_id"] != "custom"]
    assert real_buildings == []


def test_get_buildings_seeded(app_db, client):
    # Seed two buildings in fixture DB
    import sqlite3
    with sqlite3.connect(app_db) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO buildings (building_id, name, lat, lng) VALUES (?, ?, ?, ?)",
            ("second", "Second Building", 40.11, -88.22),
        )
        conn.commit()
    r = client.get("/buildings")
    assert r.status_code == 200
    data = r.json()
    assert len(data["buildings"]) >= 1
    ids = [b["building_id"] for b in data["buildings"]]
    assert "test_bldg" in ids


def test_post_schedule_class_success(app_db, client):
    r = client.post(
        "/schedule/classes",
        json={
            "title": "CS 101",
            "days_of_week": ["MON", "WED"],
            "start_time_local": "09:30",
            "building_id": "test_bldg",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "CS 101"
    assert data["days_of_week"] == ["MON", "WED"]
    assert data["start_time_local"] == "09:30"
    assert data["building_id"] == "test_bldg"
    assert "class_id" in data and len(data["class_id"]) > 0


def test_get_schedule_classes_after_create(app_db, client):
    client.post(
        "/schedule/classes",
        json={
            "title": "Math 231",
            "days_of_week": ["TUE", "THU"],
            "start_time_local": "14:00",
            "building_id": "test_bldg",
        },
    )
    r = client.get("/schedule/classes")
    assert r.status_code == 200
    data = r.json()
    assert "classes" in data
    assert len(data["classes"]) >= 1
    titles = [c["title"] for c in data["classes"]]
    assert "Math 231" in titles


def test_post_schedule_class_validation_empty_title(app_db, client):
    r = client.post(
        "/schedule/classes",
        json={
            "title": "   ",
            "days_of_week": ["MON"],
            "start_time_local": "10:00",
            "building_id": "test_bldg",
        },
    )
    assert r.status_code == 422


def test_post_schedule_class_validation_invalid_day(app_db, client):
    r = client.post(
        "/schedule/classes",
        json={
            "title": "CS 101",
            "days_of_week": ["MONDAY"],
            "start_time_local": "10:00",
            "building_id": "test_bldg",
        },
    )
    assert r.status_code == 422


def test_post_schedule_class_validation_invalid_time(app_db, client):
    r = client.post(
        "/schedule/classes",
        json={
            "title": "CS 101",
            "days_of_week": ["MON"],
            "start_time_local": "25:00",
            "building_id": "test_bldg",
        },
    )
    assert r.status_code == 422


def test_post_schedule_class_building_not_found(app_db, client):
    r = client.post(
        "/schedule/classes",
        json={
            "title": "CS 101",
            "days_of_week": ["MON", "WED"],
            "start_time_local": "09:30",
            "building_id": "nonexistent_building",
        },
    )
    assert r.status_code == 400
    assert "not found" in r.json().get("detail", "").lower()


def test_create_class_repo_building_not_found(app_db):
    with pytest.raises(ValueError, match="not found"):
        create_class(
            app_db,
            title="X",
            days_of_week=["MON"],
            start_time_local="09:00",
            building_id="nonexistent",
        )
