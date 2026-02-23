#!/usr/bin/env python3
"""
Download MTD GTFS data and load into data/gtfs.db.
Usage: python scripts/load_gtfs.py
"""
import io
import sqlite3
import zipfile
from pathlib import Path

import httpx

GTFS_URL = "https://developer.cumtd.com/gtfs/google_transit.zip"
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "gtfs.db"


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS gtfs_routes (
            route_id TEXT PRIMARY KEY,
            route_short_name TEXT,
            route_long_name TEXT
        );
        CREATE TABLE IF NOT EXISTS gtfs_trips (
            trip_id TEXT PRIMARY KEY,
            route_id TEXT,
            service_id TEXT,
            headsign TEXT,
            shape_id TEXT
        );
        CREATE TABLE IF NOT EXISTS gtfs_stop_times (
            trip_id TEXT NOT NULL,
            stop_id TEXT NOT NULL,
            arrival_time TEXT,
            departure_time TEXT,
            stop_sequence INTEGER
        );
        CREATE TABLE IF NOT EXISTS gtfs_shapes (
            shape_id TEXT NOT NULL,
            shape_pt_lat REAL,
            shape_pt_lon REAL,
            shape_pt_sequence INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON gtfs_stop_times(stop_id);
        CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON gtfs_stop_times(trip_id);
        CREATE INDEX IF NOT EXISTS idx_shapes_id ON gtfs_shapes(shape_id);
        CREATE TABLE IF NOT EXISTS gtfs_stops (
            stop_id TEXT PRIMARY KEY,
            stop_name TEXT,
            stop_lat REAL,
            stop_lon REAL
        );
        CREATE INDEX IF NOT EXISTS idx_stops_id ON gtfs_stops(stop_id);
        """
    )
    conn.commit()


def load_csv(zf: zipfile.ZipFile, filename: str) -> list[dict]:
    with zf.open(filename) as f:
        import csv
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        return list(reader)


def load_gtfs() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading GTFS from {GTFS_URL} ...")
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        resp = client.get(GTFS_URL)
        resp.raise_for_status()
        data = resp.content
    print(f"Downloaded {len(data):,} bytes. Parsing ...")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        routes = load_csv(zf, "routes.txt")
        trips = load_csv(zf, "trips.txt")
        stop_times = load_csv(zf, "stop_times.txt")
        try:
            shapes = load_csv(zf, "shapes.txt")
        except KeyError:
            shapes = []
        try:
            stops = load_csv(zf, "stops.txt")
        except KeyError:
            stops = []

    print(f"routes={len(routes)} trips={len(trips)} stop_times={len(stop_times)} shapes={len(shapes)} stops={len(stops)}")

    with sqlite3.connect(DB_PATH) as conn:
        init_db(conn)
        # Clear old data
        conn.executescript(
            "DELETE FROM gtfs_routes; DELETE FROM gtfs_trips; "
            "DELETE FROM gtfs_stop_times; DELETE FROM gtfs_shapes; DELETE FROM gtfs_stops;"
        )

        conn.executemany(
            "INSERT OR REPLACE INTO gtfs_routes (route_id, route_short_name, route_long_name) VALUES (?, ?, ?)",
            [(r.get("route_id", ""), r.get("route_short_name", ""), r.get("route_long_name", "")) for r in routes],
        )

        conn.executemany(
            "INSERT OR REPLACE INTO gtfs_trips (trip_id, route_id, service_id, headsign, shape_id) VALUES (?, ?, ?, ?, ?)",
            [
                (
                    t.get("trip_id", ""),
                    t.get("route_id", ""),
                    t.get("service_id", ""),
                    t.get("trip_headsign", ""),
                    t.get("shape_id", ""),
                )
                for t in trips
            ],
        )

        CHUNK = 5000
        st_rows = [
            (
                s.get("trip_id", ""),
                s.get("stop_id", ""),
                s.get("arrival_time", ""),
                s.get("departure_time", ""),
                int(s.get("stop_sequence", 0) or 0),
            )
            for s in stop_times
        ]
        for i in range(0, len(st_rows), CHUNK):
            conn.executemany(
                "INSERT INTO gtfs_stop_times (trip_id, stop_id, arrival_time, departure_time, stop_sequence) VALUES (?, ?, ?, ?, ?)",
                st_rows[i : i + CHUNK],
            )
            conn.commit()

        shape_rows = [
            (
                s.get("shape_id", ""),
                float(s.get("shape_pt_lat", 0) or 0),
                float(s.get("shape_pt_lon", 0) or 0),
                int(s.get("shape_pt_sequence", 0) or 0),
            )
            for s in shapes
        ]
        for i in range(0, len(shape_rows), CHUNK):
            conn.executemany(
                "INSERT INTO gtfs_shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence) VALUES (?, ?, ?, ?)",
                shape_rows[i : i + CHUNK],
            )
            conn.commit()

        if stops:
            conn.executemany(
                "INSERT OR REPLACE INTO gtfs_stops (stop_id, stop_name, stop_lat, stop_lon) VALUES (?, ?, ?, ?)",
                [
                    (
                        s.get("stop_id", ""),
                        s.get("stop_name", ""),
                        float(s.get("stop_lat", 0) or 0),
                        float(s.get("stop_lon", 0) or 0),
                    )
                    for s in stops
                ],
            )
            conn.commit()

    print(f"GTFS data loaded into {DB_PATH}")


if __name__ == "__main__":
    load_gtfs()
