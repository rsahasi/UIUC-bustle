"""Tests for stops_repo search_nearby."""
import sqlite3
import tempfile
from pathlib import Path

import pytest

from src.data.stops_repo import init_db, search_nearby, StopRecord, _bbox_delta_deg


@pytest.fixture
def temp_db():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = f.name
    try:
        init_db(path)
        with sqlite3.connect(path) as conn:
            conn.executemany(
                "INSERT INTO stops (stop_id, stop_name, lat, lng) VALUES (?, ?, ?, ?)",
                [
                    ("IT", "Illinois Terminal", 40.1136, -88.2434),
                    ("GEN", "Green & Wright", 40.1085, -88.2272),
                    ("FAR", "Far away", 40.5, -88.5),
                ],
            )
            conn.commit()
        yield path
    finally:
        Path(path).unlink(missing_ok=True)


def test_search_nearby_returns_stops_sorted_by_distance(temp_db):
    # Query near Illinois Terminal
    results = search_nearby(temp_db, lat=40.113, lng=-88.243, radius_m=2000, limit=10)
    assert len(results) >= 2
    assert results[0].stop_id == "IT"
    assert results[0].stop_name == "Illinois Terminal"
    assert results[0].lat == 40.1136
    assert results[0].lng == -88.2434


def test_search_nearby_respects_limit(temp_db):
    results = search_nearby(temp_db, lat=40.11, lng=-88.24, radius_m=50000, limit=2)
    assert len(results) == 2


def test_search_nearby_respects_radius(temp_db):
    # Far away stop at 40.5, -88.5 should not appear within 10km of (40.11, -88.24)
    results = search_nearby(temp_db, lat=40.11, lng=-88.24, radius_m=10_000, limit=10)
    stop_ids = [s.stop_id for s in results]
    assert "FAR" not in stop_ids


def test_search_nearby_empty_when_db_missing():
    results = search_nearby("/nonexistent/stops.db", 40.0, -88.0, 800, limit=10)
    assert results == []


def test_bbox_delta_deg_reasonable():
    dlat, dlng = _bbox_delta_deg(40.0, -88.0, 1000)
    # 1 km ~ 1/111 deg lat
    assert 0.005 < dlat < 0.02
    assert 0.005 < dlng < 0.02
