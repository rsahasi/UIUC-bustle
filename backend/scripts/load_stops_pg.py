"""Load MTD stops into the PostgreSQL `stops` table.

The recommendation engine reads stops from PostgreSQL (`src/data/stops_repo.
search_nearby`). With that table empty, `/stops/nearby` returns nothing, the
bus-candidate loop in the recommendation service never runs, and every route
suggestion comes back walk-only with no error logged.

Source of truth is the GTFS feed already downloaded by `load_gtfs.py`, so the
two stores cannot drift. GTFS lists one row per boarding point, suffixed
`:1`, `:2`, ... (`PAR:2`, `IT:4`). MTD's departures API and the rest of this
app key off the bare parent id (`PAR`, `IT`), so platforms are collapsed to
their parent here.

Usage:
    python scripts/load_stops_pg.py                 # load from data/gtfs.db
    python scripts/load_stops_pg.py --dry-run       # parse and report only
    python scripts/load_stops_pg.py --gtfs-db PATH
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from settings import get_settings  # noqa: E402
from src.data.db import init_pool, close_pool, get_pool  # noqa: E402
from src.data.stops_repo import StopRecord, upsert_stops  # noqa: E402

DEFAULT_GTFS_DB = BACKEND_ROOT / "data" / "gtfs.db"

# GTFS stop names carry a boarding-point qualifier the parent stop should not
# inherit: "Goodwin & Gregory (NE Corner)" -> "Goodwin & Gregory".
_QUALIFIER_RE = re.compile(r"\s*\([^)]*\)\s*$")


def _parent_id(stop_id: str) -> str:
    return stop_id.split(":", 1)[0]


def _clean_name(stop_name: str) -> str:
    return _QUALIFIER_RE.sub("", stop_name).strip()


def read_parent_stops(gtfs_db: Path) -> list[StopRecord]:
    """Collapse GTFS boarding points into parent stops.

    Position is the centroid of the parent's boarding points, which keeps a
    stop spanning both sides of an intersection centred on the intersection
    rather than on whichever platform happened to be listed first.
    """
    if not gtfs_db.exists():
        raise FileNotFoundError(
            f"{gtfs_db} not found. Run `python scripts/load_gtfs.py` first."
        )

    with sqlite3.connect(gtfs_db) as conn:
        rows = conn.execute(
            "SELECT stop_id, stop_name, stop_lat, stop_lon FROM gtfs_stops"
        ).fetchall()

    grouped: dict[str, list[tuple[str, str, float, float]]] = defaultdict(list)
    for stop_id, stop_name, lat, lon in rows:
        if lat is None or lon is None:
            continue
        grouped[_parent_id(stop_id)].append((stop_id, stop_name or "", lat, lon))

    stops: list[StopRecord] = []
    for parent, members in grouped.items():
        # A bare row for the parent itself is authoritative when present.
        bare = next((m for m in members if m[0] == parent), None)
        if bare is not None:
            name = _clean_name(bare[1]) or parent
        else:
            names = [_clean_name(m[1]) for m in members if _clean_name(m[1])]
            name = names[0] if names else parent

        lat = sum(m[2] for m in members) / len(members)
        lng = sum(m[3] for m in members) / len(members)
        stops.append(StopRecord(stop_id=parent, stop_name=name, lat=lat, lng=lng))

    stops.sort(key=lambda s: s.stop_id)
    return stops


async def load(gtfs_db: Path, dry_run: bool) -> int:
    stops = read_parent_stops(gtfs_db)
    print(f"Derived {len(stops)} parent stops from {gtfs_db}")
    for s in stops[:5]:
        print(f"  {s.stop_id:<12} {s.stop_name[:40]:<42} {s.lat:.5f}, {s.lng:.5f}")
    if len(stops) > 5:
        print(f"  ... and {len(stops) - 5} more")

    if dry_run:
        print("\n--dry-run: nothing written.")
        return len(stops)

    database_url = get_settings().database_url
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. See backend/.env.example — the app reads "
            "stops from PostgreSQL, not SQLite."
        )

    await init_pool(database_url)
    try:
        written = await upsert_stops(get_pool(), stops)
        total = await get_pool().fetchval("SELECT count(*) FROM stops")
        print(f"\nUpserted {written} stops. Table now holds {total}.")
    finally:
        await close_pool()
    return len(stops)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--gtfs-db", type=Path, default=DEFAULT_GTFS_DB)
    ap.add_argument("--dry-run", action="store_true", help="parse and report, write nothing")
    args = ap.parse_args()
    asyncio.run(load(args.gtfs_db, args.dry_run))


if __name__ == "__main__":
    main()
