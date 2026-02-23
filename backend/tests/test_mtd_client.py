"""Unit tests for MTD client: cache hit/miss and response normalization."""
import time
from unittest.mock import patch

import pytest

from src.mtd.client import (
    MTDClient,
    _normalize_departure,
    _normalize_departures_response,
    _TTLCache,
)


# --- Cache tests ---


def test_ttl_cache_miss_then_hit():
    """First get is miss, second get within TTL is hit."""
    cache = _TTLCache(ttl_seconds=60)
    assert cache.get("k1") is None
    cache.set("k1", "v1")
    assert cache.get("k1") == "v1"


def test_ttl_cache_expiry():
    """After TTL expires, get returns None (cache miss)."""
    cache = _TTLCache(ttl_seconds=1)
    cache.set("k1", "v1")
    assert cache.get("k1") == "v1"
    time.sleep(1.1)
    assert cache.get("k1") is None


def test_mtd_client_departures_cache_miss_then_hit():
    """First get_departures_by_stop is cache miss, second within 60s is cache hit."""
    with patch("src.mtd.client.httpx.Client") as mock_client_cls:
        mock_resp = mock_client_cls.return_value.__enter__.return_value.get.return_value
        mock_resp.json.return_value = {"departures": []}
        mock_resp.raise_for_status = lambda: None

        client = MTDClient(api_key="test-key")
        # First call: cache miss, hits API
        client.get_departures_by_stop("IT", minutes=60)
        assert mock_client_cls.return_value.__enter__.return_value.get.call_count == 1
        # Second call: cache hit, no extra API call
        client.get_departures_by_stop("IT", minutes=60)
        assert mock_client_cls.return_value.__enter__.return_value.get.call_count == 1


def test_mtd_client_departures_different_keys_different_entries():
    """Different (stop_id, minutes) use different cache keys."""
    with patch("src.mtd.client.httpx.Client") as mock_client_cls:
        mock_resp = mock_client_cls.return_value.__enter__.return_value.get.return_value
        mock_resp.json.return_value = {"departures": []}
        mock_resp.raise_for_status = lambda: None

        client = MTDClient(api_key="test-key")
        client.get_departures_by_stop("IT", minutes=60)
        client.get_departures_by_stop("IT", minutes=30)
        client.get_departures_by_stop("GEN", minutes=60)
        assert mock_client_cls.return_value.__enter__.return_value.get.call_count == 3


# --- Normalization tests ---


def test_normalize_departure_full():
    """Normalize a full MTD-style departure to our schema."""
    raw = {
        "route": {"route_short_name": "5", "route_id": "5"},
        "headsign": "Lincoln Square",
        "expected_mins": 7,
        "expected": "2025-02-20T14:32:00",
        "is_monitored": True,
    }
    out = _normalize_departure(raw)
    assert out["route"] == "5"
    assert out["headsign"] == "Lincoln Square"
    assert out["expected_mins"] == 7
    assert out["expected_time_iso"] == "2025-02-20T14:32:00"
    assert out["is_realtime"] is True


def test_normalize_departure_minimal():
    """Minimal raw departure still produces valid normalized fields."""
    raw = {}
    out = _normalize_departure(raw)
    assert out["route"] == ""
    assert out["headsign"] == ""
    assert out["expected_mins"] == 0
    assert out["expected_time_iso"] is None
    assert out["is_realtime"] is False


def test_normalize_departures_response_top_level_departures():
    """Response with top-level 'departures' list is normalized."""
    raw = {
        "departures": [
            {
                "route": {"route_short_name": "12"},
                "headsign": "Downtown",
                "expected_mins": 3,
                "expected": "2025-02-20T14:30:00",
                "is_monitored": False,
            },
        ],
    }
    out = _normalize_departures_response("IT", raw)
    assert out["stop_id"] == "IT"
    assert len(out["departures"]) == 1
    assert out["departures"][0]["route"] == "12"
    assert out["departures"][0]["headsign"] == "Downtown"
    assert out["departures"][0]["expected_mins"] == 3
    assert out["departures"][0]["is_realtime"] is False


def test_normalize_departures_response_rsp_wrapper():
    """Response with rsp.departures is normalized."""
    raw = {
        "rsp": {
            "departures": [
                {
                    "route": {"route_id": "22"},
                    "headsign": "Research Park",
                    "expected_mins": 10,
                    "expected": None,
                    "is_monitored": True,
                },
            ],
        },
    }
    out = _normalize_departures_response("GEN", raw)
    assert out["stop_id"] == "GEN"
    assert len(out["departures"]) == 1
    assert out["departures"][0]["route"] == "22"
    assert out["departures"][0]["expected_time_iso"] is None
    assert out["departures"][0]["is_realtime"] is True


def test_normalize_departures_response_empty():
    """Empty or missing departures list yields stop_id + empty list."""
    out = _normalize_departures_response("X", {})
    assert out["stop_id"] == "X"
    assert out["departures"] == []
