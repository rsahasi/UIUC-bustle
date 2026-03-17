import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.data.buildings_repo import (
    list_buildings, get_building, search_buildings,
    create_class, delete_class, list_classes, BuildingRecord, ClassRecord
)


def make_pool(*fetch_return, fetchrow_return=None, execute_return="INSERT 0 1"):
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=list(fetch_return))
    pool.fetchrow = AsyncMock(return_value=fetchrow_return)
    pool.execute = AsyncMock(return_value=execute_return)
    return pool


@pytest.mark.asyncio
async def test_list_buildings_returns_records():
    row = {"building_id": "siebel", "name": "Siebel Center", "lat": 40.1, "lng": -88.2}
    pool = make_pool(row)
    result = await list_buildings(pool)
    assert len(result) == 1
    assert result[0].building_id == "siebel"
    assert result[0].name == "Siebel Center"
    pool.fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_building_found():
    row = {"building_id": "siebel", "name": "Siebel Center", "lat": 40.1, "lng": -88.2}
    pool = make_pool(fetchrow_return=row)
    result = await get_building(pool, "siebel")
    assert result is not None
    assert result.building_id == "siebel"


@pytest.mark.asyncio
async def test_get_building_not_found():
    pool = make_pool(fetchrow_return=None)
    result = await get_building(pool, "unknown")
    assert result is None


@pytest.mark.asyncio
async def test_search_buildings_returns_results():
    row = {"building_id": "siebel", "name": "Siebel Center", "lat": 40.1, "lng": -88.2}
    pool = make_pool(row)
    result = await search_buildings(pool, "siebel", limit=6)
    assert len(result) == 1
    assert result[0].building_id == "siebel"
    pool.fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_class_returns_record():
    pool = make_pool()
    pool.fetchrow = AsyncMock(return_value={
        "building_id": "siebel", "name": "Siebel Center", "lat": 40.1, "lng": -88.2
    })
    result = await create_class(
        pool,
        title="CS 101",
        days_of_week=["MON", "WED"],
        start_time_local="09:00",
        building_id="siebel",
        user_id="default",
    )
    assert result.title == "CS 101"
    assert result.days_of_week == ["MON", "WED"]
    pool.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_class_returns_true_on_success():
    pool = make_pool(execute_return="DELETE 1")
    result = await delete_class(pool, "some-class-id", "default")
    assert result is True


@pytest.mark.asyncio
async def test_delete_class_returns_false_when_not_found():
    pool = make_pool(execute_return="DELETE 0")
    result = await delete_class(pool, "nonexistent", "default")
    assert result is False


@pytest.mark.asyncio
async def test_list_classes_parses_days_of_week():
    row = {
        "class_id": "abc", "user_id": "default", "title": "CS 101",
        "days_of_week": '["MON","WED"]', "start_time_local": "09:00",
        "building_id": "siebel", "destination_lat": None, "destination_lng": None,
        "destination_name": None, "end_time_local": "10:00"
    }
    pool = make_pool(row)
    result = await list_classes(pool, "default")
    assert result[0].days_of_week == ["MON", "WED"]
    assert result[0].title == "CS 101"
