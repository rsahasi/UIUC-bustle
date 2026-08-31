#!/usr/bin/env python3
"""
Load MTD stops into the database the app actually reads.

This script previously wrote to a local SQLite file (data/stops.db) that no
code path opens: `src/data/stops_repo.search_nearby` queries PostgreSQL. It
also ran `DELETE FROM stops` against a table it never created, so it failed on
a fresh checkout.

Stops now come from the GTFS feed via `scripts/load_stops_pg.py`, so the stop
list and the schedule data cannot drift apart. This wrapper is kept because the
README and existing habits reference it.

Usage:
    python scripts/load_stops.py              # -> load_stops_pg.py
    python scripts/load_stops.py --dry-run
"""
import runpy
import sys
from pathlib import Path

backend = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend))


def main() -> int:
    print("load_stops.py now delegates to scripts/load_stops_pg.py "
          "(PostgreSQL, sourced from GTFS).\n")
    sys.argv[0] = str(Path(__file__).with_name("load_stops_pg.py"))
    runpy.run_path(sys.argv[0], run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
