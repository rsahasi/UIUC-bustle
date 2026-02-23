"""
Champaign-Urbana MTD Developer API client with in-memory TTL cache for departures.
Includes timeouts, retry with exponential backoff, and clear error handling.
"""
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

MTD_BASE = "https://developer.cumtd.com/api/v2.2/json"
DEPARTURES_CACHE_TTL_SECONDS = 60
VEHICLES_CACHE_TTL_SECONDS = 10
MTD_REQUEST_TIMEOUT_SECONDS = 10.0
MTD_RETRY_ATTEMPTS = 3
MTD_RETRY_BASE_DELAY_SECONDS = 1.0
MTD_RETRY_MAX_DELAY_SECONDS = 8.0


class _TTLCache:
    """Simple in-memory TTL cache. One TTL per key (60s from first set)."""

    def __init__(self, ttl_seconds: int = DEPARTURES_CACHE_TTL_SECONDS):
        self._ttl = ttl_seconds
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() >= expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (value, time.monotonic() + self._ttl)


def _normalize_departure(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a single departure from MTD API to our schema."""
    route_info = raw.get("route") or {}
    route_short = route_info.get("route_short_name") or route_info.get("route_id") or ""
    headsign = raw.get("headsign") or ""
    expected = raw.get("expected")  # ISO-like or "YYYY-MM-DDTHH:MM:SS"
    expected_mins = raw.get("expected_mins")
    if expected_mins is None and expected:
        # API may give expected time only; we keep expected_mins if present
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(expected.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            delta = dt - datetime.now(timezone.utc)
            expected_mins = max(0, int(delta.total_seconds() / 60))
        except Exception:
            expected_mins = 0
    expected_time_iso = expected if isinstance(expected, str) else None
    # Realtime: MTD uses vehicle tracking; treat is_monitored as realtime
    is_realtime = raw.get("is_monitored", False) if isinstance(raw.get("is_monitored"), bool) else False
    return {
        "route": route_short,
        "headsign": headsign,
        "expected_mins": expected_mins if expected_mins is not None else 0,
        "expected_time_iso": expected_time_iso,
        "is_realtime": is_realtime,
    }


def _normalize_departures_response(stop_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize GetDeparturesByStop response to { stop_id, departures[] }."""
    departures: list[dict[str, Any]] = []
    # CUMTD wraps in rsp.departures or top-level "departures"
    rsp = raw.get("rsp", raw)
    dep_list = raw.get("departures") or (rsp.get("departures") if isinstance(rsp, dict) else None) or (rsp.get("Departures") if isinstance(rsp, dict) else None) or []
    if not isinstance(dep_list, list):
        dep_list = []
    for d in dep_list:
        if isinstance(d, dict):
            departures.append(_normalize_departure(d))
    return {"stop_id": stop_id, "departures": departures}


class MTDClient:
    """Client for Champaign-Urbana MTD Developer API with 60s TTL cache for departures."""

    def __init__(self, api_key: str, base_url: str = MTD_BASE):
        self._api_key = api_key
        self._base = base_url.rstrip("/")
        self._departures_cache = _TTLCache(ttl_seconds=DEPARTURES_CACHE_TTL_SECONDS)
        self._vehicles_cache = _TTLCache(ttl_seconds=VEHICLES_CACHE_TTL_SECONDS)

    def _cache_key(self, stop_id: str, minutes: int) -> str:
        return f"dep:{stop_id}:{minutes}"

    def get_departures_by_stop(self, stop_id: str, minutes: int = 60) -> dict[str, Any]:
        """
        Get departures for a stop. Cached for 60 seconds per (stop_id, minutes).
        Returns normalized shape: { stop_id, departures: [{ route, headsign, expected_mins, expected_time_iso, is_realtime }] }.
        """
        ckey = self._cache_key(stop_id, minutes)
        cached = self._departures_cache.get(ckey)
        if cached is not None:
            logger.info(
                "telemetry departures_served cache_hit=true stop_id=%s",
                stop_id,
                extra={"stop_id": stop_id, "cache_hit": True},
            )
            return cached

        logger.info(
            "telemetry departures_served cache_hit=false stop_id=%s",
            stop_id,
            extra={"stop_id": stop_id, "cache_hit": False},
        )
        url = f"{self._base}/GetDeparturesByStop"
        params = {"key": self._api_key, "stop_id": stop_id, "pt": min(60, max(0, minutes))}
        last_error: Exception | None = None
        for attempt in range(MTD_RETRY_ATTEMPTS):
            try:
                with httpx.Client(timeout=MTD_REQUEST_TIMEOUT_SECONDS) as client:
                    resp = client.get(url, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                normalized = _normalize_departures_response(stop_id, data)
                self._departures_cache.set(ckey, normalized)
                logger.info(
                    "telemetry mtd_departures_fetched stop_id=%s count=%s",
                    stop_id,
                    len(normalized["departures"]),
                    extra={"stop_id": stop_id, "count": len(normalized["departures"])},
                )
                return normalized
            except httpx.TimeoutException as e:
                last_error = e
                logger.warning(
                    "telemetry mtd_timeout attempt=%s stop_id=%s",
                    attempt + 1,
                    stop_id,
                    extra={"attempt": attempt + 1, "stop_id": stop_id},
                )
            except (httpx.HTTPError, ValueError) as e:
                last_error = e
                logger.warning(
                    "telemetry mtd_api_error attempt=%s stop_id=%s error=%s",
                    attempt + 1,
                    stop_id,
                    str(e),
                    extra={"attempt": attempt + 1, "stop_id": stop_id, "error": str(e)},
                )
            if attempt < MTD_RETRY_ATTEMPTS - 1:
                delay = min(
                    MTD_RETRY_BASE_DELAY_SECONDS * (2**attempt),
                    MTD_RETRY_MAX_DELAY_SECONDS,
                )
                time.sleep(delay)
        # Retries exhausted; raise with a clear message
        msg = "MTD API unavailable (timeout or error after retries)."
        if last_error:
            raise RuntimeError(msg) from last_error
        raise RuntimeError(msg)

    def get_vehicles_in_service(self, route_id: str | None = None) -> list[dict[str, Any]]:
        """
        Get vehicles currently in service. Cached for 10s.
        Returns list of { vehicle_id, lat, lng, heading, route_id }.
        Optionally filter by route_id.
        """
        cache_key = f"vehicles:{route_id or 'all'}"
        cached = self._vehicles_cache.get(cache_key)
        if cached is not None:
            return cached

        url = f"{self._base}/GetVehicles"
        params: dict[str, Any] = {"key": self._api_key}
        if route_id:
            params["route_id"] = route_id

        try:
            with httpx.Client(timeout=MTD_REQUEST_TIMEOUT_SECONDS) as client:
                resp = client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            logger.warning("telemetry mtd_vehicles_error error=%s", str(e))
            return []

        raw_list = data.get("vehicles") or []
        if not isinstance(raw_list, list):
            raw_list = []

        result: list[dict[str, Any]] = []
        for v in raw_list:
            if not isinstance(v, dict):
                continue
            try:
                trip = v.get("trip") or {}
                loc = v.get("location") or {}
                result.append({
                    "vehicle_id": str(v.get("vehicle_id") or ""),
                    "lat": float(loc.get("lat") or 0),
                    "lng": float(loc.get("lon") or 0),
                    "heading": float(v.get("heading") or 0),
                    "route_id": str(trip.get("route_id") or ""),
                    "headsign": str(trip.get("trip_headsign") or ""),
                })
            except (TypeError, ValueError):
                continue

        self._vehicles_cache.set(cache_key, result)
        logger.info("telemetry mtd_vehicles_fetched count=%s", len(result))
        return result
