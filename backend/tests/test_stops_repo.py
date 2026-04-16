import pytest
from unittest.mock import AsyncMock, MagicMock
from src.data.stops_repo import search_nearby, upsert_stop


def make_pool(*fetch_return, execute_return="INSERT 0 1"):
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=list(fetch_return))
    pool.execute = AsyncMock(return_value=execute_return)
    return pool


@pytest.mark.asyncio
async def test_search_nearby_returns_stops_within_radius():
    # Stop at UIUC (very close to search origin)
    row = {"stop_id": "IUB", "stop_name": "Illinois & University", "lat": 40.1020, "lng": -88.2272}
    pool = make_pool(row)
    results = await search_nearby(pool, lat=40.1020, lng=-88.2272, radius_m=500)
    assert len(results) == 1
    assert results[0].stop_id == "IUB"


@pytest.mark.asyncio
async def test_search_nearby_filters_beyond_radius():
    # Stop far away — bounding box includes it but Haversine filters it out
    row = {"stop_id": "FAR", "stop_name": "Far Stop", "lat": 40.2000, "lng": -88.2272}
    pool = make_pool(row)
    results = await search_nearby(pool, lat=40.1020, lng=-88.2272, radius_m=200)
    assert len(results) == 0


@pytest.mark.asyncio
async def test_search_nearby_respects_limit():
    rows = [
        {"stop_id": f"S{i}", "stop_name": f"Stop {i}", "lat": 40.1020 + i * 0.0001, "lng": -88.2272}
        for i in range(5)
    ]
    pool = make_pool(*rows)
    results = await search_nearby(pool, lat=40.1020, lng=-88.2272, radius_m=5000, limit=2)
    assert len(results) <= 2


@pytest.mark.asyncio
async def test_upsert_stop_calls_execute():
    pool = make_pool()
    await upsert_stop(pool, "IUB", "Illinois & University", 40.1020, -88.2272)
    pool.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_search_nearby_empty_db():
    pool = make_pool()  # fetch returns []
    results = await search_nearby(pool, lat=40.1020, lng=-88.2272, radius_m=500)
    assert results == []
