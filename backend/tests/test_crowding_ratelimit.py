"""Concurrency tests for the crowding per-token rate limit.

The endpoint used to check the limit and insert as two separate statements on
two separate connections. Simultaneous submissions carrying the same token all
passed the SELECT before any INSERT landed, so a single client could stack
reports and dominate a vehicle's weighted average. These tests pin the atomic
behaviour that replaced it.
"""
import asyncio

import pytest

from src.data.crowding_repo import (
    init_crowding_schema,
    insert_report_if_allowed,
    get_recent_reports,
    compute_weighted_level,
)


@pytest.fixture
async def db(tmp_path):
    path = tmp_path / "crowding.db"
    await init_crowding_schema(path)
    return path


async def _submit(db_path, token, level=4, vehicle="veh-1"):
    return await insert_report_if_allowed(
        db_path,
        vehicle_id=vehicle,
        route_id="22",
        trip_id=None,
        crowding_level=level,
        user_token=token,
        lat=None,
        lon=None,
    )


async def test_sequential_duplicate_is_rejected(db):
    assert await _submit(db, "token-a") is True
    assert await _submit(db, "token-a") is False
    assert len(await get_recent_reports(db, "veh-1")) == 1


async def test_concurrent_duplicates_admit_exactly_one(db):
    """The race the two-statement version lost."""
    results = await asyncio.gather(*(_submit(db, "token-a") for _ in range(10)))

    assert sum(results) == 1, f"expected exactly one insert, got {sum(results)}"
    assert len(await get_recent_reports(db, "veh-1")) == 1


async def test_concurrent_reports_cannot_skew_the_aggregate(db):
    """One honest report plus a burst from a single token must not be outvoted."""
    await _submit(db, "honest-user", level=1)
    await asyncio.gather(*(_submit(db, "spammer", level=4) for _ in range(20)))

    reports = await get_recent_reports(db, "veh-1")
    # Two distinct tokens, so exactly two rows regardless of burst size.
    # (get_recent_reports intentionally does not expose the token.)
    assert len(reports) == 2
    assert sorted(r["crowding_level"] for r in reports) == [1, 4]

    agg = compute_weighted_level(reports)
    assert agg is not None
    assert agg.report_count == 2


async def test_different_tokens_are_independent(db):
    results = await asyncio.gather(*(_submit(db, f"token-{i}") for i in range(5)))
    assert all(results)
    assert len(await get_recent_reports(db, "veh-1")) == 5


async def test_same_token_different_vehicles_is_allowed(db):
    assert await _submit(db, "token-a", vehicle="veh-1") is True
    assert await _submit(db, "token-a", vehicle="veh-2") is True


async def test_anonymous_reports_stay_unlimited(db):
    """A NULL token never matches the recency check, preserving prior behaviour."""
    results = await asyncio.gather(*(_submit(db, None) for _ in range(5)))
    assert all(results)
    assert len(await get_recent_reports(db, "veh-1")) == 5
