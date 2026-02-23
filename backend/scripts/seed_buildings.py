#!/usr/bin/env python3
"""
Seed the app DB with the Buildings table (and create default user + empty schedule).

Usage:
  python scripts/seed_buildings.py
  python scripts/seed_buildings.py --csv data/my_buildings.csv --db data/app.db

To expand the list: edit data/buildings_seed.csv (or create your own CSV with columns
building_id, name, lat, lng) and run this script again. Existing buildings are
replaced by matching building_id; new rows are inserted.
"""
import argparse
import csv
import sys
from pathlib import Path

backend = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend))

from src.data.buildings_repo import init_app_db


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed buildings (and init app DB)")
    parser.add_argument(
        "--csv",
        default=backend / "data" / "buildings_seed.csv",
        type=Path,
        help="CSV with columns: building_id, name, lat, lng",
    )
    parser.add_argument(
        "--db",
        default=backend / "data" / "app.db",
        type=Path,
        help="Path to app SQLite DB",
    )
    args = parser.parse_args()

    if not args.csv.exists():
        print(f"Error: CSV not found: {args.csv}", file=sys.stderr)
        return 1

    init_app_db(args.db)

    import sqlite3
    count = 0
    with sqlite3.connect(args.db) as conn:
        with open(args.csv, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                bid = (row.get("building_id") or "").strip()
                name = (row.get("name") or "").strip()
                try:
                    lat = float(row.get("lat", 0))
                    lng = float(row.get("lng", 0))
                except (TypeError, ValueError):
                    continue
                if not bid:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO buildings (building_id, name, lat, lng) VALUES (?, ?, ?, ?)",
                    (bid, name, lat, lng),
                )
                count += 1
        conn.commit()

    print(f"Seeded {count} buildings into {args.db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
