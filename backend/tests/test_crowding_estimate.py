from datetime import datetime, timezone, date, timedelta
import pytest
from src.data.crowding_estimate import estimate_crowding_level

def _dt(hour: int, weekday: int = 0) -> datetime:
    d = date(2026, 3, 10)  # A Monday (weekday=0)
    days_offset = (weekday - d.weekday()) % 7
    d = d + timedelta(days=days_offset)
    return datetime(d.year, d.month, d.day, hour, 0, 0, tzinfo=timezone.utc)

def test_peak_morning_weekday():
    result = estimate_crowding_level("22S", _dt(8, weekday=0))
    assert result["level"] >= 3

def test_peak_afternoon_weekday():
    result = estimate_crowding_level("22S", _dt(17, weekday=2))
    assert result["level"] >= 3

def test_late_night():
    result = estimate_crowding_level("ANY", _dt(23, weekday=0))
    assert result["level"] <= 2

def test_weekend_lower():
    weekday_peak = estimate_crowding_level("22S", _dt(8, weekday=1))
    weekend_same_time = estimate_crowding_level("22S", _dt(8, weekday=6))
    assert weekend_same_time["level"] <= weekday_peak["level"]

def test_source_is_estimated():
    result = estimate_crowding_level("22S", _dt(8))
    assert result["source"] == "estimated"
    assert result["confidence"] == "estimated"

def test_midday_moderate():
    result = estimate_crowding_level("22S", _dt(12, weekday=1))
    assert 1 <= result["level"] <= 3
