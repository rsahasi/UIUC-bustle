"""
Local stops repository: SQLite-backed with Haversine nearby search.
"""
import sqlite3
from pathlib import Path
from typing import NamedTuple

from src.data.geo import haversine_distance_km


class StopRecord(NamedTuple):
    stop_id: str
    stop_name: str
    lat: float
    lng: float


def _bbox_delta_deg(lat: float, lng: float, radius_m: float) -> tuple[float, float]:
    """Approximate lat/lng deltas for a bounding box around (lat, lng) with radius_m meters."""
    # 1 deg lat ~ 111 km; 1 deg lng ~ 111 * cos(lat) km
    import math
    km = radius_m / 1000.0
    dlat = km / 111.0
    dlng = km / (111.0 * max(0.01, math.cos(math.radians(lat))))
    return dlat, dlng


def search_nearby(
    db_path: str | Path,
    lat: float,
    lng: float,
    radius_m: float,
    limit: int = 10,
) -> list[StopRecord]:
    """
    Return stops within radius_m of (lat, lng), sorted by distance, up to limit.
    Uses bounding box on indexed (lat, lng) then Haversine filter/sort for speed.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        return []

    dlat, dlng = _bbox_delta_deg(lat, lng, radius_m)
    lat_lo, lat_hi = lat - dlat, lat + dlat
    lng_lo, lng_hi = lng - dlng, lng + dlng

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT stop_id, stop_name, lat, lng
            FROM stops
            WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
            """,
            (lat_lo, lat_hi, lng_lo, lng_hi),
        )
        rows = cur.fetchall()

    # Haversine filter and sort
    radius_km = radius_m / 1000.0
    with_dist: list[tuple[float, StopRecord]] = []
    for r in rows:
        stop = StopRecord(stop_id=r["stop_id"], stop_name=r["stop_name"], lat=r["lat"], lng=r["lng"])
        d = haversine_distance_km(lat, lng, stop.lat, stop.lng)
        if d <= radius_km:
            with_dist.append((d, stop))
    with_dist.sort(key=lambda x: x[0])
    return [stop for _, stop in with_dist[:limit]]


def init_db(db_path: str | Path) -> None:
    """Create stops table and index if they do not exist."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS stops (
                stop_id TEXT PRIMARY KEY,
                stop_name TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_stops_lat_lng ON stops(lat, lng)"
        )
        conn.commit()
