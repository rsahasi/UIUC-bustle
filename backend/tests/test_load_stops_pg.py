"""Tests for deriving parent stops from the GTFS feed.

The PostgreSQL `stops` table was never populated, so `/stops/nearby` returned
nothing and every recommendation came back walk-only. These pin the derivation
that fills it, in particular that ids come out in the bare form MTD's
departures API and the rest of the app expect.
"""
import sqlite3
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from scripts.load_stops_pg import read_parent_stops, _clean_name, _parent_id


@pytest.fixture
def gtfs_db(tmp_path):
    """A miniature GTFS stops table with the shapes that matter."""
    path = tmp_path / "gtfs.db"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE gtfs_stops (stop_id TEXT PRIMARY KEY, stop_name TEXT, "
            "stop_lat REAL, stop_lon REAL)"
        )
        conn.executemany(
            "INSERT INTO gtfs_stops VALUES (?, ?, ?, ?)",
            [
                # Parent with a bare row present: the bare name wins.
                ("IT", "Illinois Terminal", 40.1156, -88.2411),
                ("IT:1", "Illinois Terminal (Platform A)", 40.1159, -88.2409),
                ("IT:2", "Illinois Terminal (Platform B)", 40.1153, -88.2413),
                # Parent with no bare row: qualifier is stripped off a platform.
                ("GWNGRG:1", "Goodwin & Gregory (NE Corner)", 40.1044, -88.2238),
                ("GWNGRG:3", "Goodwin & Gregory (SW Corner)", 40.1042, -88.2240),
                # Single boarding point.
                ("ARB:1", "Arboretum (North Side)", 40.0995, -88.2290),
                # Null coordinates must be dropped, not written as NULL.
                ("BAD:1", "Broken Stop", None, None),
            ],
        )
    return path


def test_ids_are_bare_parents(gtfs_db):
    stops = read_parent_stops(gtfs_db)
    ids = {s.stop_id for s in stops}
    assert ids == {"IT", "GWNGRG", "ARB"}
    assert all(":" not in s.stop_id for s in stops)


def test_bare_row_name_wins_over_platform_names(gtfs_db):
    stops = {s.stop_id: s for s in read_parent_stops(gtfs_db)}
    assert stops["IT"].stop_name == "Illinois Terminal"


def test_boarding_point_qualifier_is_stripped(gtfs_db):
    stops = {s.stop_id: s for s in read_parent_stops(gtfs_db)}
    assert stops["GWNGRG"].stop_name == "Goodwin & Gregory"
    assert stops["ARB"].stop_name == "Arboretum"


def test_position_is_the_centroid_of_boarding_points(gtfs_db):
    stops = {s.stop_id: s for s in read_parent_stops(gtfs_db)}
    # A stop spanning an intersection should sit at the intersection, not on
    # whichever platform happened to be listed first.
    assert stops["GWNGRG"].lat == pytest.approx((40.1044 + 40.1042) / 2)
    assert stops["GWNGRG"].lng == pytest.approx((-88.2238 + -88.2240) / 2)


def test_rows_without_coordinates_are_skipped(gtfs_db):
    stops = read_parent_stops(gtfs_db)
    assert all(s.stop_id != "BAD" for s in stops)
    assert all(s.lat is not None and s.lng is not None for s in stops)


def test_output_is_deterministic(gtfs_db):
    assert [s.stop_id for s in read_parent_stops(gtfs_db)] == \
           [s.stop_id for s in read_parent_stops(gtfs_db)]


def test_missing_gtfs_db_names_the_fix(tmp_path):
    with pytest.raises(FileNotFoundError, match="load_gtfs.py"):
        read_parent_stops(tmp_path / "absent.db")


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Goodwin & Gregory (NE Corner)", "Goodwin & Gregory"),
        ("Illinois Terminal", "Illinois Terminal"),
        ("First & Daniel (SE Far Side)", "First & Daniel"),
        ("U.S. 150 & Dale (NE Corner)", "U.S. 150 & Dale"),
        # Only a trailing qualifier is removed; interior parens stay.
        ("Foo (Bar) Baz", "Foo (Bar) Baz"),
    ],
)
def test_clean_name(raw, expected):
    assert _clean_name(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [("PAR:2", "PAR"), ("IT", "IT"), ("150DALE:1", "150DALE")],
)
def test_parent_id(raw, expected):
    assert _parent_id(raw) == expected
