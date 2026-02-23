"""Tests for recommendation: scoring helpers and output schema."""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.recommendation.service import (
    _parse_arrive_by,
    _ride_minutes_heuristic,
    _walk_minutes,
    compute_recommendations,
)

# --- Scoring / helpers ---


def test_walk_minutes():
    # 840m at 1.4 m/s -> 840/(1.4*60) = 10 min
    assert abs(_walk_minutes(840, 1.4) - 10.0) < 0.1
    assert _walk_minutes(0, 1.4) == 0.0


def test_ride_minutes_heuristic():
    # 3600m at 6 m/s -> 600s -> 10 min
    assert abs(_ride_minutes_heuristic(3600) - 10.0) < 0.1
    assert _ride_minutes_heuristic(0) == 0.0


def test_parse_arrive_by():
    t = _parse_arrive_by("2025-02-20T15:30:00Z")
    assert t is not None
    assert t.hour == 15 and t.minute == 30
    assert _parse_arrive_by("invalid") is None


# --- Output schema and WALK option ---


def test_compute_recommendations_returns_walk_option_and_schema():
    """Building exists; no stops/departures -> only WALK option with correct schema."""
    now = datetime(2025, 2, 20, 14, 0, 0, tzinfo=timezone.utc)
    arrive = "2025-02-20T15:00:00Z"  # 60 min from now

    def get_building(bid: str):
        if bid == "siebel":
            return (40.1138, -88.2246, "Siebel Center")
        return None

    def search_nearby(lat: float, lng: float, radius_m: float, limit: int):
        return []

    def get_departures(stop_id: str):
        return []

    b = get_building("siebel")
    assert b is not None
    options = compute_recommendations(
        lat=40.11,
        lng=-88.22,
        destination_building_id="siebel",
        destination_lat=b[0],
        destination_lng=b[1],
        destination_name=b[2],
        arrive_by_iso=arrive,
        walking_speed_mps=1.4,
        buffer_minutes=5,
        max_options=3,
        now=now,
        get_building=get_building,
        search_nearby_stops=search_nearby,
        get_departures=get_departures,
    )
    assert len(options) >= 1
    walk = next((o for o in options if o["type"] == "WALK"), None)
    assert walk is not None
    assert walk["type"] == "WALK"
    assert "summary" in walk
    assert "eta_minutes" in walk
    assert "depart_in_minutes" in walk
    assert "steps" in walk
    assert len(walk["steps"]) >= 1
    assert walk["steps"][0]["type"] == "WALK_TO_DEST"
    assert walk["steps"][0]["building_id"] == "siebel"
    assert isinstance(walk["eta_minutes"], (int, float))
    assert isinstance(walk["depart_in_minutes"], (int, float))


def test_compute_recommendations_with_explicit_destination_returns_walk():
    """When destination is passed as lat/lng/name (no building lookup), still get walk option."""
    now = datetime(2025, 2, 20, 14, 0, 0, tzinfo=timezone.utc)
    options = compute_recommendations(
        lat=40.11,
        lng=-88.22,
        destination_building_id="custom",
        destination_lat=40.1138,
        destination_lng=-88.2246,
        destination_name="Custom Place",
        arrive_by_iso="2025-02-20T15:00:00Z",
        now=now,
        get_building=lambda bid: None,
        search_nearby_stops=lambda *a: [],
        get_departures=lambda s: [],
    )
    assert len(options) >= 1
    walk = next((o for o in options if o["type"] == "WALK"), None)
    assert walk is not None


def test_compute_recommendations_bus_option_steps_schema():
    """With one stop and one departure, get one BUS option with all step types."""
    now = datetime(2025, 2, 20, 14, 0, 0, tzinfo=timezone.utc)
    arrive = "2025-02-20T16:00:00Z"

    def get_building(bid: str):
        if bid == "altgeld":
            return (40.1028, -88.2282, "Altgeld Hall")
        return None

    def search_nearby(lat: float, lng: float, radius_m: float, limit: int):
        if lat > 40.1 and lat < 40.12:
            return [("IT", "Illinois Terminal", 40.1136, -88.2434)]
        return []

    def get_departures(stop_id: str):
        return [{"route": "5", "headsign": "Lincoln", "expected_mins": 5}]

    b = get_building("altgeld")
    assert b is not None
    options = compute_recommendations(
        lat=40.112,
        lng=-88.24,
        destination_building_id="altgeld",
        destination_lat=b[0],
        destination_lng=b[1],
        destination_name=b[2],
        arrive_by_iso=arrive,
        walking_speed_mps=1.4,
        buffer_minutes=5,
        max_options=3,
        now=now,
        get_building=get_building,
        search_nearby_stops=search_nearby,
        get_departures=get_departures,
    )
    bus_options = [o for o in options if o["type"] == "BUS"]
    assert len(bus_options) >= 1
    bus = bus_options[0]
    assert bus["type"] == "BUS"
    step_types = [s["type"] for s in bus["steps"]]
    assert "WALK_TO_STOP" in step_types
    assert "WAIT" in step_types
    assert "RIDE" in step_types
    assert "WALK_TO_DEST" in step_types
    ride_step = next(s for s in bus["steps"] if s["type"] == "RIDE")
    assert ride_step["route"] == "5"
    assert "duration_minutes" in ride_step


def test_post_recommendation_building_not_found_returns_400():
    """POST /recommendation with unknown building_id returns 400."""
    import main
    client = TestClient(main.app)
    r = client.post(
        "/recommendation",
        json={
            "lat": 40.11,
            "lng": -88.22,
            "destination_building_id": "nonexistent_building",
            "arrive_by_iso": "2025-02-20T16:00:00Z",
        },
    )
    assert r.status_code == 400
    assert "not found" in r.json().get("detail", "").lower()


def test_post_recommendation_schema_and_stable(tmp_path):
    """POST /recommendation returns 200 and options with correct schema (stable)."""
    import main
    from src.data.buildings_repo import init_app_db
    import sqlite3
    from datetime import datetime, timezone, timedelta
    app_db = tmp_path / "app.db"
    init_app_db(app_db)
    with sqlite3.connect(app_db) as conn:
        conn.execute(
            "INSERT INTO buildings (building_id, name, lat, lng) VALUES (?, ?, ?, ?)",
            ("test_bldg", "Test Building", 40.10, -88.22),
        )
        conn.commit()
    main.APP_DB = app_db
    # Use arrive_by 2 hours from now so walk option is valid
    arrive = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    client = TestClient(main.app)
    r = client.post(
        "/recommendation",
        json={
            "lat": 40.11,
            "lng": -88.22,
            "destination_building_id": "test_bldg",
            "arrive_by_iso": arrive,
            "max_options": 3,
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert "options" in data
    assert isinstance(data["options"], list)
    assert len(data["options"]) >= 1
    for opt in data["options"]:
        assert opt["type"] in ("WALK", "BUS")
        assert "summary" in opt
        assert "eta_minutes" in opt
        assert "depart_in_minutes" in opt
        assert "steps" in opt
        for step in opt["steps"]:
            assert "type" in step
            assert step["type"] in ("WALK_TO_STOP", "WAIT", "RIDE", "WALK_TO_DEST")
