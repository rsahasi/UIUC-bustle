"""Tests for the startup GTFS->Postgres stops seeding (_seed_stops_from_gtfs).

Uses a mocked asyncpg pool and a temporary SQLite GTFS snapshot, so no real
database is required.
"""
import sqlite3
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import main


def _pool(count_existing=0):
    pool = MagicMock()
    pool.execute = AsyncMock(return_value="DELETE 0")
    pool.fetchval = AsyncMock(return_value=count_existing)
    pool.executemany = AsyncMock(return_value=None)
    return pool


def _make_gtfs_db(tmp_path: Path, rows) -> Path:
    db = tmp_path / "gtfs.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE gtfs_stops (stop_id TEXT, stop_name TEXT, stop_lat REAL, stop_lon REAL)")
    conn.executemany("INSERT INTO gtfs_stops VALUES (?,?,?,?)", rows)
    conn.commit()
    conn.close()
    return db


@pytest.mark.asyncio
async def test_seed_skips_when_table_already_populated(tmp_path):
    pool = _pool(count_existing=42)
    with patch("main.get_pool", return_value=pool), patch("main.GTFS_DB", tmp_path / "gtfs.db"):
        await main._seed_stops_from_gtfs()
    # Always purges colon child stops first, then bails out without seeding.
    pool.execute.assert_awaited_once()
    pool.executemany.assert_not_awaited()


@pytest.mark.asyncio
async def test_seed_skips_when_gtfs_db_missing(tmp_path):
    pool = _pool(count_existing=0)
    with patch("main.get_pool", return_value=pool), patch("main.GTFS_DB", tmp_path / "nope.db"):
        await main._seed_stops_from_gtfs()
    pool.executemany.assert_not_awaited()


@pytest.mark.asyncio
async def test_seed_inserts_parents_only(tmp_path):
    db = _make_gtfs_db(tmp_path, [
        ("IU", "Illini Union", 40.10, -88.22),       # parent — kept
        ("IU:1", "Illini Union Pt 1", 40.10, -88.22),  # colon child — excluded
        ("NOCOORD", "Missing Coords", None, None),      # null coords — excluded
    ])
    pool = _pool(count_existing=0)
    with patch("main.get_pool", return_value=pool), patch("main.GTFS_DB", db):
        await main._seed_stops_from_gtfs()

    pool.executemany.assert_awaited_once()
    seeded = pool.executemany.await_args[0][1]  # the list of param tuples
    ids = [row[0] for row in seeded]
    assert ids == ["IU"]
    assert seeded[0] == ("IU", "Illini Union", 40.10, -88.22)


@pytest.mark.asyncio
async def test_seed_falls_back_to_stop_id_when_name_missing(tmp_path):
    db = _make_gtfs_db(tmp_path, [("ABC", "", 40.1, -88.2)])
    pool = _pool(count_existing=0)
    with patch("main.get_pool", return_value=pool), patch("main.GTFS_DB", db):
        await main._seed_stops_from_gtfs()
    seeded = pool.executemany.await_args[0][1]
    assert seeded[0][1] == "ABC"  # name falls back to stop_id
