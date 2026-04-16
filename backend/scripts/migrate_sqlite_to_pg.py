"""
One-time migration: copy buildings, users, and schedule_classes from local
SQLite app.db into the target PostgreSQL database.

Usage:
    DATABASE_URL=postgresql://user:pass@host/db python scripts/migrate_sqlite_to_pg.py

Run once after Railway PostgreSQL is provisioned. Stops are excluded —
they start empty and are populated by the app on demand.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

import psycopg2

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SQLITE_PATH = BACKEND_ROOT / "data" / "app.db"
DATABASE_URL = os.environ.get("DATABASE_URL", "")

if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable not set.", file=sys.stderr)
    sys.exit(1)

if not SQLITE_PATH.exists():
    print(f"ERROR: SQLite file not found at {SQLITE_PATH}", file=sys.stderr)
    sys.exit(1)

print(f"Reading from: {SQLITE_PATH}")
print(f"Writing to:   {DATABASE_URL.split('@')[-1]}")  # hide credentials

sqlite_conn = sqlite3.connect(str(SQLITE_PATH))
sqlite_conn.row_factory = sqlite3.Row
pg_conn = psycopg2.connect(DATABASE_URL)
pg_cur = pg_conn.cursor()

# --- buildings ---
rows = sqlite_conn.execute("SELECT building_id, name, lat, lng FROM buildings").fetchall()
print(f"Migrating {len(rows)} buildings...")
for row in rows:
    pg_cur.execute(
        "INSERT INTO buildings (building_id, name, lat, lng) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (row["building_id"], row["name"], row["lat"], row["lng"]),
    )

# --- users ---
rows = sqlite_conn.execute("SELECT user_id FROM users").fetchall()
print(f"Migrating {len(rows)} users...")
for row in rows:
    pg_cur.execute(
        "INSERT INTO users (user_id) VALUES (%s) ON CONFLICT DO NOTHING",
        (row["user_id"],),
    )

# --- schedule_classes ---
rows = sqlite_conn.execute("SELECT * FROM schedule_classes").fetchall()
print(f"Migrating {len(rows)} schedule classes...")
for row in rows:
    pg_cur.execute(
        """INSERT INTO schedule_classes
           (class_id, user_id, title, days_of_week, start_time_local, building_id,
            destination_lat, destination_lng, destination_name, end_time_local)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT DO NOTHING""",
        (
            row["class_id"], row["user_id"], row["title"],
            row["days_of_week"], row["start_time_local"], row["building_id"],
            row["destination_lat"], row["destination_lng"],
            row["destination_name"], row["end_time_local"],
        ),
    )

pg_conn.commit()
pg_cur.close()
pg_conn.close()
sqlite_conn.close()
print("Migration complete.")
