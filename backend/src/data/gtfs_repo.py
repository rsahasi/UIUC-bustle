"""
GTFS SQLite repository for real scheduled travel times.
Populated by scripts/load_gtfs.py.
"""
from __future__ import annotations

import contextlib
import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)


def _stop_id_clause(column: str) -> str:
    """
    SQL predicate matching a bare stop ID against GTFS platform-suffixed IDs.

    GTFS stop_times store "PAR:2" while app-side and MTD real-time IDs are bare
    ("PAR"). Anchoring on the ":" delimiter keeps "PAR" from also matching the
    physically unrelated "PARACE:1" and "PARKVIEW:2". Binds two params (the same
    stop ID twice).
    """
    return f"({column} = ? OR {column} LIKE ? || ':%')"


def _stop_id_matches(stop_id: str, wanted: str) -> bool:
    """Python-side counterpart of _stop_id_clause."""
    return stop_id == wanted or stop_id.startswith(wanted + ":")


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
    # sqlite3's own connection context manager only ends the transaction; wrap in
    # closing() so the handle is released too.
    with contextlib.closing(sqlite3.connect(db_path)) as conn, conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            f"""
            SELECT st.trip_id, t.route_id, t.headsign, st.departure_time, st.stop_sequence
            FROM gtfs_stop_times st
            JOIN gtfs_trips t ON t.trip_id = st.trip_id
            WHERE {_stop_id_clause("st.stop_id")}
            ORDER BY st.departure_time
            """,
            (stop_id, stop_id),
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
    with contextlib.closing(sqlite3.connect(db_path)) as conn, conn:
        conn.row_factory = sqlite3.Row
        # Pad after_time to HH:MM:SS for string comparison (GTFS times are zero-padded)
        padded_after = after_time.strip() if after_time.strip() else "00:00:00"
        # Find trips with both stops, origin before dest, departing at or after after_time.
        # MTD real-time stop IDs (e.g. "GRGMUM") are the prefix of GTFS stop IDs (e.g. "GRGMUM:1"),
        # so match on the ":"-delimited prefix to handle both formats.
        cur = conn.execute(
            f"""
            SELECT
                o.trip_id,
                t.route_id,
                t.headsign,
                o.departure_time AS dep_time,
                d.arrival_time AS arr_time,
                o.stop_sequence AS o_seq,
                d.stop_sequence AS d_seq
            FROM gtfs_stop_times o
            JOIN gtfs_stop_times d ON d.trip_id = o.trip_id AND {_stop_id_clause("d.stop_id")} AND d.stop_sequence > o.stop_sequence
            JOIN gtfs_trips t ON t.trip_id = o.trip_id
            WHERE {_stop_id_clause("o.stop_id")} AND o.departure_time >= ?
            ORDER BY o.departure_time
            LIMIT 10
            """,
            (dest_stop_id, dest_stop_id, origin_stop_id, origin_stop_id, padded_after),
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


def get_stops_for_trip_between(
    db_path: str | Path,
    trip_id: str,
    from_stop_id: str,
    to_stop_id: str,
) -> list[dict]:
    """
    Return stops (inclusive) between from_stop_id and to_stop_id for a trip.
    Each entry: { stop_id, stop_name, lat, lng, sequence, arrival_time }.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        return []
    with contextlib.closing(sqlite3.connect(db_path)) as conn, conn:
        conn.row_factory = sqlite3.Row
        # Get sequence numbers for from/to stops.
        # Match on the ":"-delimited prefix so MTD IDs (e.g. "GRGMUM") match GTFS IDs (e.g. "GRGMUM:1").
        cur = conn.execute(
            f"""
            SELECT stop_id, stop_sequence FROM gtfs_stop_times
            WHERE trip_id = ? AND ({_stop_id_clause("stop_id")} OR {_stop_id_clause("stop_id")})
            """,
            (trip_id, from_stop_id, from_stop_id, to_stop_id, to_stop_id),
        )
        rows = cur.fetchall()
        from_seqs = [
            r["stop_sequence"] for r in rows
            if r["stop_sequence"] is not None and _stop_id_matches(r["stop_id"], from_stop_id)
        ]
        to_seqs = [
            r["stop_sequence"] for r in rows
            if r["stop_sequence"] is not None and _stop_id_matches(r["stop_id"], to_stop_id)
        ]
        if not from_seqs:
            return []
        # Loop routes visit the same stop twice, so the destination is the first
        # visit downstream of the origin rather than the earliest one overall.
        from_seq = min(from_seqs)
        to_seq = min((seq for seq in to_seqs if seq > from_seq), default=None)
        if to_seq is None:
            return []
        cur2 = conn.execute(
            """
            SELECT st.stop_id, st.stop_sequence, st.arrival_time,
                   gs.stop_name, gs.stop_lat, gs.stop_lon
            FROM gtfs_stop_times st
            LEFT JOIN gtfs_stops gs ON gs.stop_id = st.stop_id
            WHERE st.trip_id = ? AND st.stop_sequence BETWEEN ? AND ?
            ORDER BY st.stop_sequence
            """,
            (trip_id, from_seq, to_seq),
        )
        return [
            {
                "stop_id": r["stop_id"],
                "stop_name": r["stop_name"] or r["stop_id"],
                "lat": r["stop_lat"] or 0.0,
                "lng": r["stop_lon"] or 0.0,
                "sequence": r["stop_sequence"],
                "arrival_time": r["arrival_time"] or "",
            }
            for r in cur2.fetchall()
        ]


def get_shape_for_trip(
    db_path: str | Path,
    trip_id: str,
) -> list[tuple[float, float]]:
    """Return list of (lat, lng) shape points for a trip."""
    db_path = Path(db_path)
    if not db_path.exists():
        return []
    with contextlib.closing(sqlite3.connect(db_path)) as conn, conn:
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


def find_best_exit_stop_for_route(
    db_path: str | Path,
    route_id: str,
    from_stop_id: str,
    dest_lat: float,
    dest_lng: float,
    after_time: str = "00:00:00",
) -> dict | None:
    """
    For a specific route departing from from_stop_id, find the downstream stop
    closest to (dest_lat, dest_lng). Returns { stop_id, stop_name, lat, lng, travel_minutes }
    or None if GTFS DB unavailable or no matching trip found.
    """
    import math
    db_path = Path(db_path)
    if not db_path.exists():
        return None
    dep_min_floor = _time_to_minutes(after_time) or 0
    padded = after_time.strip() if after_time.strip() else "00:00:00"
    try:
        with contextlib.closing(sqlite3.connect(db_path)) as conn, conn:
            conn.row_factory = sqlite3.Row
            # Find the soonest trip for this route that serves from_stop_id AND
            # continues past it. A trip that terminates at from_stop_id (e.g. the
            # inbound TEAL ending at PAR) has no downstream stop to exit at, and
            # picking it would hide the next trip a minute later that does.
            cur = conn.execute(
                f"""
                SELECT st.trip_id, st.stop_sequence AS from_seq, st.departure_time
                FROM gtfs_stop_times st
                JOIN gtfs_trips t ON t.trip_id = st.trip_id
                WHERE t.route_id = ? AND {_stop_id_clause("st.stop_id")} AND st.departure_time >= ?
                  AND EXISTS (
                      SELECT 1 FROM gtfs_stop_times d
                      WHERE d.trip_id = st.trip_id AND d.stop_sequence > st.stop_sequence
                  )
                ORDER BY st.departure_time
                LIMIT 1
                """,
                (route_id, from_stop_id, from_stop_id, padded),
            )
            row = cur.fetchone()
            if row is None:
                return None
            trip_id = row["trip_id"]
            from_seq = row["from_seq"]
            dep_min = _time_to_minutes(row["departure_time"] or "") or dep_min_floor

            # All downstream stops for this trip
            cur2 = conn.execute(
                """
                SELECT st.stop_id, st.arrival_time,
                       gs.stop_name, gs.stop_lat, gs.stop_lon
                FROM gtfs_stop_times st
                LEFT JOIN gtfs_stops gs ON gs.stop_id = st.stop_id
                WHERE st.trip_id = ? AND st.stop_sequence > ?
                ORDER BY st.stop_sequence
                """,
                (trip_id, from_seq),
            )
            stops = cur2.fetchall()
            if not stops:
                return None

            best: dict | None = None
            best_dist = float("inf")
            for s in stops:
                slat = float(s["stop_lat"] or 0)
                slng = float(s["stop_lon"] or 0)
                if slat == 0.0 and slng == 0.0:
                    continue
                # Scale longitude by cos(latitude) so east-west degrees aren't
                # overstated (~23% error at UIUC's latitude otherwise).
                dlat = slat - dest_lat
                dlng = (slng - dest_lng) * math.cos(math.radians(dest_lat))
                dist = math.sqrt(dlat ** 2 + dlng ** 2) * 111_000
                if dist < best_dist:
                    best_dist = dist
                    arr_min = _time_to_minutes(s["arrival_time"] or "")
                    travel_min = (arr_min - dep_min) if arr_min is not None and arr_min > dep_min else None
                    best = {
                        "stop_id": s["stop_id"],
                        "stop_name": s["stop_name"] or s["stop_id"],
                        "lat": slat,
                        "lng": slng,
                        "travel_minutes": travel_min,
                    }
            return best
    except Exception:
        logger.warning(
            "gtfs exit stop lookup failed route=%s from_stop=%s",
            route_id,
            from_stop_id,
            exc_info=True,
        )
        return None


def get_all_stops_for_route(db_path: str | Path, route_id: str) -> list[dict]:
    """
    Return the ordered stop list for a route using the most common trip as the reference.
    Each entry: { stop_id, stop_name, lat, lng, sequence }.
    Returns [] if GTFS DB is unavailable or the route has no trips.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        return []
    try:
        with contextlib.closing(sqlite3.connect(db_path)) as conn, conn:
            conn.row_factory = sqlite3.Row
            # Find the trip_id with the most stops for this route (canonical trip)
            cur = conn.execute(
                """
                SELECT st.trip_id, COUNT(*) AS stop_count
                FROM gtfs_stop_times st
                JOIN gtfs_trips t ON t.trip_id = st.trip_id
                WHERE t.route_id = ?
                GROUP BY st.trip_id
                ORDER BY stop_count DESC
                LIMIT 1
                """,
                (route_id,),
            )
            row = cur.fetchone()
            if row is None:
                return []
            trip_id = row["trip_id"]
            cur2 = conn.execute(
                """
                SELECT st.stop_id, st.stop_sequence,
                       gs.stop_name, gs.stop_lat, gs.stop_lon
                FROM gtfs_stop_times st
                LEFT JOIN gtfs_stops gs ON gs.stop_id = st.stop_id
                WHERE st.trip_id = ?
                ORDER BY st.stop_sequence
                """,
                (trip_id,),
            )
            return [
                {
                    "stop_id": r["stop_id"],
                    "stop_name": r["stop_name"] or r["stop_id"],
                    "lat": float(r["stop_lat"] or 0),
                    "lng": float(r["stop_lon"] or 0),
                    "sequence": r["stop_sequence"],
                }
                for r in cur2.fetchall()
                if float(r["stop_lat"] or 0) != 0 or float(r["stop_lon"] or 0) != 0
            ]
    except Exception:
        logger.warning("gtfs route stop list failed route=%s", route_id, exc_info=True)
        return []
