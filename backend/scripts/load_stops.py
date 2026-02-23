#!/usr/bin/env python3
"""
Load stops from a CSV file into the local SQLite DB.

CSV must have columns: stop_id, stop_name, lat, lng
(Header row expected.)

To use official GTFS data later:
  1. Download GTFS zip from MTD/CUMTD (e.g. https://mtd.org/gtfs or your agency).
  2. Unzip and use stops.txt (columns: stop_id, stop_name, stop_lat, stop_lon).
  3. Either rename columns in CSV to lat/lng or change this script to map stop_lat/stop_lon -> lat/lng.
  4. Run: python scripts/load_stops.py --csv path/to/stops.txt
"""
import argparse
import csv
import sys
from pathlib import Path

# Add backend root to path
backend = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend))

from src.data.stops_repo import init_db


def main() -> int:
    parser = argparse.ArgumentParser(description="Load stops CSV into SQLite")
    parser.add_argument(
        "--csv",
        default=backend / "data" / "stops_placeholder.csv",
        type=Path,
        help="Path to CSV (stop_id, stop_name, lat, lng) or GTFS stops.txt (stop_id, stop_name, stop_lat, stop_lon)",
    )
    parser.add_argument(
        "--db",
        default=backend / "data" / "stops.db",
        type=Path,
        help="Path to SQLite DB file",
    )
    parser.add_argument(
        "--gtfs",
        action="store_true",
        help="CSV is GTFS stops.txt (use stop_lat, stop_lon instead of lat, lng)",
    )
    args = parser.parse_args()

    if not args.csv.exists():
        print(f"Error: CSV not found: {args.csv}", file=sys.stderr)
        return 1

    args.db.parent.mkdir(parents=True, exist_ok=True)
    init_db(args.db)

    lat_col = "stop_lat" if args.gtfs else "lat"
    lng_col = "stop_lon" if args.gtfs else "lng"

    import sqlite3
    with open(args.csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print("Error: empty CSV", file=sys.stderr)
            return 1
        # Normalize headers (strip BOM / spaces)
        fieldnames = [h.strip().lower().lstrip("\ufeff") for h in reader.fieldnames]
        if "stop_id" not in fieldnames or lat_col not in fieldnames or lng_col not in fieldnames:
            # Try GTFS names
            if "stop_lat" in fieldnames and "stop_lon" in fieldnames:
                lat_col, lng_col = "stop_lat", "stop_lon"
                args.gtfs = True
            else:
                print(f"Error: CSV must have stop_id, stop_name, and lat/lng (or stop_lat/stop_lon). Got: {fieldnames}", file=sys.stderr)
                return 1
        name_col = "stop_name" if "stop_name" in fieldnames else "stop_name"

    count = 0
    with sqlite3.connect(args.db) as conn:
        conn.execute("DELETE FROM stops")
        with open(args.csv, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                row = {k.strip().lower().lstrip("\ufeff"): v for k, v in row.items()}
                stop_id = (row.get("stop_id") or "").strip()
                stop_name = (row.get(name_col) or "").strip()
                try:
                    lat = float(row.get(lat_col, 0))
                    lng = float(row.get(lng_col, 0))
                except (TypeError, ValueError):
                    continue
                if not stop_id:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO stops (stop_id, stop_name, lat, lng) VALUES (?, ?, ?, ?)",
                    (stop_id, stop_name, lat, lng),
                )
                count += 1
        conn.commit()

    print(f"Loaded {count} stops into {args.db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
