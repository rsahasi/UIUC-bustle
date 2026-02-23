"""
GTFS SQLite repository for real scheduled travel times.
Populated by scripts/load_gtfs.py.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path


def _time_to_minutes(t: str) -> int | None:
    """Convert 'HH:MM:SS' GTFS time string to total minutes from midnight."""
    try:
        parts = t.strip().split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return None


def get_trips_serving_stop(
    db_path: str | Path,
    stop_id: str,
    after_time: str = "00:00:00",
) -> list[dict]:
    """
    Return trips that depart from stop_id after after_time.
    Each entry: { trip_id, route_id, headsign, departure_time, stop_sequence }.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        return []
    after_min = _time_to_minutes(after_time) or 0
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT st.trip_id, t.route_id, t.headsign, st.departure_time, st.stop_sequence
            FROM gtfs_stop_times st
            JOIN gtfs_trips t ON t.trip_id = st.trip_id
            WHERE st.stop_id = ?
            ORDER BY st.departure_time
            """,
            (stop_id,),
        )
        results = []
        for r in cur.fetchall():
            dep_min = _time_to_minutes(r["departure_time"] or "")
            if dep_min is not None and dep_min >= after_min:
                results.append({
                    "trip_id": r["trip_id"],
                    "route_id": r["route_id"],
                    "headsign": r["headsign"],
                    "departure_time": r["departure_time"],
                    "stop_sequence": r["stop_sequence"],
                })
        return results


def find_connecting_trips(
    db_path: str | Path,
    origin_stop_id: str,
    dest_stop_id: str,
    after_time: str = "00:00:00",
) -> list[dict]:
    """
    Find trips that serve both origin_stop_id and dest_stop_id in order.
    Returns list of { trip_id, route_id, headsign, departure_time, arrival_time, travel_minutes }.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        return []
    after_min = _time_to_minutes(after_time) or 0
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # Find trips with both stops, origin before dest
        cur = conn.execute(
            """
            SELECT
                o.trip_id,
                t.route_id,
                t.headsign,
                o.departure_time AS dep_time,
                d.arrival_time AS arr_time,
                o.stop_sequence AS o_seq,
                d.stop_sequence AS d_seq
            FROM gtfs_stop_times o
            JOIN gtfs_stop_times d ON d.trip_id = o.trip_id AND d.stop_id = ? AND d.stop_sequence > o.stop_sequence
            JOIN gtfs_trips t ON t.trip_id = o.trip_id
            WHERE o.stop_id = ?
            ORDER BY o.departure_time
            LIMIT 10
            """,
            (dest_stop_id, origin_stop_id),
        )
        results = []
        for r in cur.fetchall():
            dep_min = _time_to_minutes(r["dep_time"] or "")
            arr_min = _time_to_minutes(r["arr_time"] or "")
            if dep_min is None or dep_min < after_min:
                continue
            travel_minutes = (arr_min - dep_min) if arr_min is not None else None
            results.append({
                "trip_id": r["trip_id"],
                "route_id": r["route_id"],
                "headsign": r["headsign"],
                "departure_time": r["dep_time"],
                "arrival_time": r["arr_time"],
                "travel_minutes": travel_minutes,
            })
        return results


def get_shape_for_trip(
    db_path: str | Path,
    trip_id: str,
) -> list[tuple[float, float]]:
    """Return list of (lat, lng) shape points for a trip."""
    db_path = Path(db_path)
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # Get shape_id for trip
        cur = conn.execute("SELECT shape_id FROM gtfs_trips WHERE trip_id = ?", (trip_id,))
        row = cur.fetchone()
        if row is None or not row["shape_id"]:
            return []
        shape_id = row["shape_id"]
        cur2 = conn.execute(
            "SELECT shape_pt_lat, shape_pt_lon FROM gtfs_shapes WHERE shape_id = ? ORDER BY shape_pt_sequence",
            (shape_id,),
        )
        return [(r["shape_pt_lat"], r["shape_pt_lon"]) for r in cur2.fetchall()]
