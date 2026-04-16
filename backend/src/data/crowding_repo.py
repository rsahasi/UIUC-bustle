"""Crowding data repository — SQLite via aiosqlite.

Provides:
- Schema initialisation (init_crowding_schema)
- Pure decay algorithm (compute_weighted_level / _weight) — no DB dependency
- Async DB helpers (insert_report, get_recent_reports, check_rate_limit,
  get_reports_by_route, delete_old_reports)
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional, TypedDict

import aiosqlite

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

CROWDING_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "app.db"

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS crowding_reports (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id         TEXT    NOT NULL,
    route_id           TEXT    NOT NULL,
    trip_id            TEXT,
    crowding_level     INTEGER NOT NULL CHECK(crowding_level BETWEEN 1 AND 4),
    anonymous_user_token TEXT,
    reported_at        TEXT    DEFAULT (datetime('now')),
    lat                REAL,
    lon                REAL
)
"""

_CREATE_IDX_VEHICLE_SQL = """
CREATE INDEX IF NOT EXISTS idx_crowding_vehicle_reported
    ON crowding_reports (vehicle_id, reported_at)
"""

_CREATE_IDX_ROUTE_SQL = """
CREATE INDEX IF NOT EXISTS idx_crowding_route_reported
    ON crowding_reports (route_id, reported_at)
"""

_CREATE_IDX_TOKEN_VEHICLE_SQL = """
CREATE INDEX IF NOT EXISTS idx_crowding_token_vehicle
    ON crowding_reports (anonymous_user_token, vehicle_id, reported_at DESC)
"""


async def init_crowding_schema(db_path: Path = CROWDING_DB_PATH) -> None:
    """Create crowding_reports table and indexes if not exist."""
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute(_CREATE_TABLE_SQL)
        await db.execute(_CREATE_IDX_VEHICLE_SQL)
        await db.execute(_CREATE_IDX_ROUTE_SQL)
        await db.execute(_CREATE_IDX_TOKEN_VEHICLE_SQL)
        await db.commit()


# ---------------------------------------------------------------------------
# Pure decay algorithm (no DB dependency — fully unit-testable)
# ---------------------------------------------------------------------------

@dataclass
class CrowdingAggregate:
    level: int        # 1–4
    confidence: str   # "low" | "medium" | "high"
    source: Literal["crowdsourced"]  # always "crowdsourced" from this function
    report_count: int


class ReportRow(TypedDict):
    crowding_level: int
    reported_at: datetime


def _weight(reported_at: datetime) -> float:
    """Return the decay weight for a single report.

    Age is measured in minutes from now (UTC).
    - age > 60 min → 0.0
    - age > 40 min → 0.25
    - age > 20 min → 0.5
    - else         → 1.0

    Boundaries use strict > comparisons, so exactly 20/40/60 min fall in the
    *higher-weight* bucket.
    """
    now = datetime.now(timezone.utc)
    age_min = (now - reported_at).total_seconds() / 60.0
    if age_min > 60:
        return 0.0
    if age_min > 40:
        return 0.25
    if age_min > 20:
        return 0.5
    return 1.0


def compute_weighted_level(reports: list[ReportRow]) -> Optional[CrowdingAggregate]:
    """Compute a weighted crowding aggregate from a list of raw reports.

    Each report dict must contain:
        - "crowding_level": int (1–4)
        - "reported_at": datetime (timezone-aware)

    Returns None if there are no active (weight > 0) reports.
    """
    total_weight = 0.0
    weighted_sum = 0.0
    active_count = 0

    for report in reports:
        w = _weight(report["reported_at"])
        if w == 0.0:
            continue
        weighted_sum += report["crowding_level"] * w
        total_weight += w
        active_count += 1

    if active_count == 0:
        return None

    raw_level = weighted_sum / total_weight
    level = max(1, min(4, round(raw_level)))

    if active_count >= 5:
        confidence = "high"
    elif active_count >= 2:
        confidence = "medium"
    else:
        confidence = "low"

    return CrowdingAggregate(
        level=level,
        confidence=confidence,
        source="crowdsourced",
        report_count=active_count,
    )


# ---------------------------------------------------------------------------
# Async DB helpers
# ---------------------------------------------------------------------------

async def insert_report(
    db_path: Path,
    vehicle_id: str,
    route_id: str,
    trip_id: Optional[str],
    crowding_level: int,
    user_token: Optional[str],
    lat: Optional[float],
    lon: Optional[float],
) -> None:
    """Insert a new crowding report into the database."""
    # One connection per call: safe for SQLite WAL mode; avoids shared-state concurrency issues.
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            """
            INSERT INTO crowding_reports
                (vehicle_id, route_id, trip_id, crowding_level,
                 anonymous_user_token, lat, lon)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (vehicle_id, route_id, trip_id, crowding_level, user_token, lat, lon),
        )
        await db.commit()


async def get_recent_reports(
    db_path: Path,
    vehicle_id: str,
    max_age_minutes: int = 60,
) -> list[dict]:
    """Return recent reports for a vehicle within the age window.

    SQLite datetimes are stored as TEXT; we parse them and attach UTC tzinfo
    before returning so callers receive timezone-aware datetime objects.
    """
    modifier = f"-{max_age_minutes} minutes"
    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute(
            """
            SELECT crowding_level, reported_at
            FROM   crowding_reports
            WHERE  vehicle_id = ?
              AND  reported_at > datetime('now', ?)
            ORDER  BY reported_at DESC
            """,
            (vehicle_id, modifier),
        )
        rows = await cursor.fetchall()

    return [
        {
            "crowding_level": row[0],
            "reported_at": datetime.fromisoformat(row[1]).replace(tzinfo=timezone.utc),
        }
        for row in rows
    ]


async def check_rate_limit(
    db_path: Path,
    user_token: str,
    vehicle_id: str,
    window_minutes: int = 10,
) -> bool:
    """Return True if the user already submitted a report for this vehicle
    within the given time window (rate-limit check).
    """
    modifier = f"-{window_minutes} minutes"
    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute(
            """
            SELECT 1
            FROM   crowding_reports
            WHERE  anonymous_user_token = ?
              AND  vehicle_id = ?
              AND  reported_at > datetime('now', ?)
            LIMIT  1
            """,
            (user_token, vehicle_id, modifier),
        )
        row = await cursor.fetchone()
    return row is not None


async def get_reports_by_route(
    db_path: Path,
    route_id: str,
    max_age_minutes: int = 60,
) -> dict[str, list[dict]]:
    """Return all recent reports for a route, grouped by vehicle_id."""
    modifier = f"-{max_age_minutes} minutes"
    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute(
            """
            SELECT vehicle_id, crowding_level, reported_at
            FROM   crowding_reports
            WHERE  route_id = ?
              AND  reported_at > datetime('now', ?)
            ORDER  BY reported_at DESC
            """,
            (route_id, modifier),
        )
        rows = await cursor.fetchall()

    grouped: dict[str, list[dict]] = {}
    for vehicle_id, crowding_level, reported_at_str in rows:
        reported_at = datetime.fromisoformat(reported_at_str).replace(tzinfo=timezone.utc)
        grouped.setdefault(vehicle_id, []).append(
            {"crowding_level": crowding_level, "reported_at": reported_at}
        )
    return grouped


async def delete_old_reports(
    db_path: Path,
    older_than_hours: int = 2,
) -> int:
    """Delete reports older than *older_than_hours* and return the row count."""
    modifier = f"-{older_than_hours} hours"
    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute(
            "DELETE FROM crowding_reports WHERE reported_at < datetime('now', ?)",
            (modifier,),
        )
        count = cursor.rowcount
        await db.commit()
        return count
