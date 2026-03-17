import math
from typing import NamedTuple
import asyncpg
from src.data.geo import haversine_distance_km


class StopRecord(NamedTuple):
    stop_id: str
    stop_name: str
    lat: float
    lng: float


def _bbox_delta_deg(lat: float, radius_m: float) -> tuple[float, float]:
    """Approximate lat/lng bounding box deltas for a given radius in meters."""
    dlat = radius_m / 111_000
    dlng = radius_m / (111_000 * math.cos(math.radians(lat)))
    return dlat, dlng


async def search_nearby(
    pool: asyncpg.Pool,
    lat: float,
    lng: float,
    radius_m: float,
    limit: int = 10,
) -> list[StopRecord]:
    dlat, dlng = _bbox_delta_deg(lat, radius_m)
    rows = await pool.fetch(
        """
        SELECT stop_id, stop_name, lat, lng FROM stops
        WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4
        """,
        lat - dlat,
        lat + dlat,
        lng - dlng,
        lng + dlng,
    )
    stops = []
    for row in rows:
        dist_km = haversine_distance_km(lat, lng, row["lat"], row["lng"])
        if dist_km * 1000 <= radius_m:
            stops.append(StopRecord(
                stop_id=row["stop_id"],
                stop_name=row["stop_name"],
                lat=row["lat"],
                lng=row["lng"],
            ))
    stops.sort(key=lambda s: haversine_distance_km(lat, lng, s.lat, s.lng))
    return stops[:limit]


async def upsert_stop(
    pool: asyncpg.Pool,
    stop_id: str,
    stop_name: str,
    lat: float,
    lng: float,
) -> None:
    await pool.execute(
        """
        INSERT INTO stops (stop_id, stop_name, lat, lng)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (stop_id) DO UPDATE SET stop_name = $2, lat = $3, lng = $4
        """,
        stop_id,
        stop_name,
        lat,
        lng,
    )
