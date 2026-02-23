"""
MVP recommendation: options from user location to destination building.
Uses nearby stops, cached departures, and heuristic ride/walk times.
TODO: Replace heuristic with real route shapes and stop sequences when available.
"""
from datetime import datetime, timezone
from typing import Callable

from src.data.geo import haversine_distance_m

# Heuristic: average bus speed (m/s) for straight-line ride time estimate
BUS_SPEED_MPS = 6.0
USER_STOP_RADIUS_M = 800
DEST_STOP_RADIUS_M = 500


def _minutes_now(now: datetime) -> float:
    """Minutes since midnight (local or UTC for consistency). Use UTC for stability."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.hour * 60 + now.minute + now.second / 60.0


def _parse_arrive_by(arrive_by_iso: str) -> datetime | None:
    try:
        t = datetime.fromisoformat(arrive_by_iso.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t
    except Exception:
        return None


def _walk_minutes(distance_m: float, walking_speed_mps: float) -> float:
    if walking_speed_mps <= 0:
        return 0.0
    return distance_m / (walking_speed_mps * 60.0)


def _ride_minutes_heuristic(distance_m: float) -> float:
    # TODO: use real route shapes and stop sequence for ride time
    if BUS_SPEED_MPS <= 0:
        return 0.0
    return distance_m / (BUS_SPEED_MPS * 60.0)


def compute_recommendations(
    *,
    lat: float,
    lng: float,
    destination_building_id: str,
    destination_lat: float,
    destination_lng: float,
    destination_name: str,
    arrive_by_iso: str,
    walking_speed_mps: float = 1.4,
    buffer_minutes: float = 5.0,
    max_options: int = 3,
    now: datetime | None = None,
    get_building: Callable[[str], tuple[float, float, str] | None],
    search_nearby_stops: Callable[[float, float, float, int], list[tuple[str, str, float, float]]],  # stop_id, name, lat, lng
    get_departures: Callable[[str], list[dict]],
) -> list[dict]:
    """
    Return list of option dicts (type, summary, eta_minutes, depart_in_minutes, steps).
    destination_lat/lng/name are the actual destination; destination_building_id is for step labels.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    arrive_by = _parse_arrive_by(arrive_by_iso)
    if arrive_by is None:
        raise ValueError("invalid_arrive_by")

    b_lat, b_lng, b_name = destination_lat, destination_lng, destination_name
    walk_speed = max(0.1, walking_speed_mps)
    max_opts = max(1, min(10, max_options))

    # Distance user -> building (meters)
    dist_user_building_m = haversine_distance_m(lat, lng, b_lat, b_lng)
    walk_only_min = _walk_minutes(dist_user_building_m, walk_speed)
    arrive_by_ts = arrive_by.timestamp()
    now_ts = now.timestamp()
    minutes_until_arrival = (arrive_by_ts - now_ts) / 60.0

    walk_option = None
    depart_in_walk = max(0.0, minutes_until_arrival - walk_only_min - buffer_minutes)
    if now_ts + depart_in_walk * 60 <= arrive_by_ts + 1:
        walk_option = {
            "type": "WALK",
            "summary": f"Walk to {b_name} ({walk_only_min:.0f} min)",
            "eta_minutes": round(walk_only_min, 1),
            "depart_in_minutes": round(depart_in_walk, 1),
            "steps": [
                {
                    "type": "WALK_TO_DEST",
                    "building_id": destination_building_id,
                    "duration_minutes": round(walk_only_min, 1),
                    "building_lat": b_lat,
                    "building_lng": b_lng,
                }
            ],
        }

    # Stops near user and near destination (for heuristic exit stop)
    user_stops = search_nearby_stops(lat, lng, USER_STOP_RADIUS_M, 10)
    dest_stops = search_nearby_stops(b_lat, b_lng, DEST_STOP_RADIUS_M, 5)
    # Closest stop to building for walk-from-stop heuristic
    exit_stop = None
    exit_dist_m = float("inf")
    for sid, sname, slat, slng in dest_stops:
        d = haversine_distance_m(slat, slng, b_lat, b_lng)
        if d < exit_dist_m:
            exit_dist_m = d
            exit_stop = (sid, sname, slat, slng)
    walk_from_stop_min = _walk_minutes(exit_dist_m, walk_speed) if exit_stop else 5.0  # default 5 min

    # TODO: use real route shapes to determine which bus goes to which stop; for now heuristic
    bus_candidates: list[tuple[float, dict]] = []

    for stop_id, stop_name, stop_lat, stop_lng in user_stops:
        walk_to_stop_m = haversine_distance_m(lat, lng, stop_lat, stop_lng)
        walk_to_stop_min = _walk_minutes(walk_to_stop_m, walk_speed)
        # Heuristic ride: straight-line from this stop to building (or to exit stop)
        if exit_stop:
            ride_dist_m = haversine_distance_m(stop_lat, stop_lng, exit_stop[2], exit_stop[3])
        else:
            ride_dist_m = haversine_distance_m(stop_lat, stop_lng, b_lat, b_lng)
        ride_min = _ride_minutes_heuristic(ride_dist_m)

        for d in get_departures(stop_id):
            route = (d.get("route") or "").strip()
            headsign = (d.get("headsign") or "").strip()
            expected_mins = int(d.get("expected_mins") or 0)
            # Wait at stop: if we walk there in walk_to_stop_min, we wait max(0, expected_mins - walk_to_stop_min)
            wait_min = max(0.0, float(expected_mins) - walk_to_stop_min)
            total_eta = walk_to_stop_min + wait_min + ride_min + walk_from_stop_min
            if total_eta > minutes_until_arrival - buffer_minutes:
                continue
            depart_in = max(0.0, minutes_until_arrival - total_eta - buffer_minutes)
            score = total_eta  # lower is better
            bus_candidates.append((score, {
                "type": "BUS",
                "summary": f"Bus {route} to {headsign or 'destination'} ({total_eta:.0f} min)",
                "eta_minutes": round(total_eta, 1),
                "depart_in_minutes": round(depart_in, 1),
                "steps": [
                    {"type": "WALK_TO_STOP", "stop_id": stop_id, "stop_name": stop_name, "duration_minutes": round(walk_to_stop_min, 1), "stop_lat": stop_lat, "stop_lng": stop_lng},
                    {"type": "WAIT", "stop_id": stop_id, "duration_minutes": round(wait_min, 1)},
                    {"type": "RIDE", "route": route, "headsign": headsign or "", "stop_id": stop_id, "duration_minutes": round(ride_min, 1),
                     "alighting_stop_id": exit_stop[0] if exit_stop else None,
                     "alighting_stop_lat": exit_stop[2] if exit_stop else None,
                     "alighting_stop_lng": exit_stop[3] if exit_stop else None},
                    {"type": "WALK_TO_DEST", "building_id": destination_building_id, "duration_minutes": round(walk_from_stop_min, 1), "building_lat": b_lat, "building_lng": b_lng},
                ],
            }))

    # Take best BUS options (by score = eta), stable sort by (score, summary)
    bus_candidates.sort(key=lambda x: (x[0], x[1]["summary"]))
    options = [opt for _, opt in bus_candidates[: max_opts - 1 if walk_option else max_opts]]
    if walk_option:
        options.append(walk_option)
    # Stable order: by eta_minutes, then summary for debuggability
    options.sort(key=lambda o: (o["eta_minutes"], o["summary"]))
    return options[:max_opts]
