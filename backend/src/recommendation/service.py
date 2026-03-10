"""
MVP recommendation: options from user location to destination building.
Uses nearby stops, cached departures, and heuristic ride/walk times.
GTFS-based exit stops used when available; falls back to heuristic.
"""
from datetime import datetime, timezone
from typing import Callable

from src.data.geo import haversine_distance_m

# Heuristic: average bus speed (m/s) for straight-line ride time estimate
BUS_SPEED_MPS = 6.0
USER_STOP_RADIUS_M = 800
DEST_STOP_RADIUS_M = 500


def _minutes_now(now: datetime) -> float:
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
    search_nearby_stops: Callable[[float, float, float, int], list[tuple[str, str, float, float]]],
    get_departures: Callable[[str], list[dict]],
    find_exit_stop_fn: Callable[[str, str, float, float, str], dict | None] | None = None,
    prefer_bus: bool = False,
) -> list[dict]:
    """
    Return list of option dicts (type, summary, eta_minutes, depart_in_minutes, steps).
    find_exit_stop_fn: optional GTFS callback(route_id, from_stop_id, dest_lat, dest_lng, after_time) -> dict|None
    """
    if now is None:
        now = datetime.now(timezone.utc)
    arrive_by = _parse_arrive_by(arrive_by_iso)
    if arrive_by is None:
        raise ValueError("invalid_arrive_by")

    b_lat, b_lng, b_name = destination_lat, destination_lng, destination_name
    walk_speed = max(0.1, walking_speed_mps)
    max_opts = max(1, min(10, max_options))

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

    user_stops = search_nearby_stops(lat, lng, USER_STOP_RADIUS_M, 10)
    dest_stops = search_nearby_stops(b_lat, b_lng, DEST_STOP_RADIUS_M, 5)

    # Fallback heuristic exit stop (closest stop to building, used when GTFS unavailable)
    heuristic_exit: tuple[str, str, float, float] | None = None
    heuristic_exit_dist_m = float("inf")
    for sid, sname, slat, slng in dest_stops:
        d = haversine_distance_m(slat, slng, b_lat, b_lng)
        if d < heuristic_exit_dist_m:
            heuristic_exit_dist_m = d
            heuristic_exit = (sid, sname, slat, slng)

    heuristic_walk_from_stop = (
        _walk_minutes(heuristic_exit_dist_m, walk_speed) if heuristic_exit else 5.0
    )

    now_time_str = now.strftime("%H:%M:%S")

    bus_candidates: list[tuple[float, dict]] = []

    for stop_id, stop_name, stop_lat, stop_lng in user_stops:
        walk_to_stop_m = haversine_distance_m(lat, lng, stop_lat, stop_lng)
        walk_to_stop_min = _walk_minutes(walk_to_stop_m, walk_speed)

        for d in get_departures(stop_id):
            route = (d.get("route") or "").strip()
            headsign = (d.get("headsign") or "").strip()
            expected_mins = float(d.get("expected_mins") or 0)

            if expected_mins < walk_to_stop_min:
                continue

            wait_min = expected_mins - walk_to_stop_min

            # --- Per-route exit stop via GTFS, fallback to heuristic ---
            gtfs_exit = None
            if find_exit_stop_fn and route:
                try:
                    gtfs_exit = find_exit_stop_fn(route, stop_id, b_lat, b_lng, now_time_str)
                except Exception:
                    pass

            if gtfs_exit:
                ex_stop_id = gtfs_exit["stop_id"]
                ex_stop_name = gtfs_exit.get("stop_name", ex_stop_id)
                ex_lat = gtfs_exit["lat"]
                ex_lng = gtfs_exit["lng"]
                if gtfs_exit.get("travel_minutes") is not None and gtfs_exit["travel_minutes"] > 0:
                    ride_min = float(gtfs_exit["travel_minutes"])
                else:
                    ride_min = _ride_minutes_heuristic(
                        haversine_distance_m(stop_lat, stop_lng, ex_lat, ex_lng)
                    )
                walk_from_min = _walk_minutes(
                    haversine_distance_m(ex_lat, ex_lng, b_lat, b_lng), walk_speed
                )
            else:
                ex_stop_id = heuristic_exit[0] if heuristic_exit else None
                ex_stop_name = heuristic_exit[1] if heuristic_exit else None
                ex_lat = heuristic_exit[2] if heuristic_exit else b_lat
                ex_lng = heuristic_exit[3] if heuristic_exit else b_lng
                ride_dist_m = haversine_distance_m(stop_lat, stop_lng, ex_lat, ex_lng)
                ride_min = _ride_minutes_heuristic(ride_dist_m)
                walk_from_min = heuristic_walk_from_stop

            total_eta = walk_to_stop_min + wait_min + ride_min + walk_from_min
            if total_eta > minutes_until_arrival - buffer_minutes:
                continue

            depart_in = max(0.0, expected_mins - walk_to_stop_min)
            score = total_eta
            bus_candidates.append((score, {
                "type": "BUS",
                "summary": f"Bus {route} to {headsign or 'destination'} ({total_eta:.0f} min)",
                "eta_minutes": round(total_eta, 1),
                "depart_in_minutes": round(depart_in, 1),
                "steps": [
                    {"type": "WALK_TO_STOP", "stop_id": stop_id, "stop_name": stop_name,
                     "duration_minutes": round(walk_to_stop_min, 1), "stop_lat": stop_lat, "stop_lng": stop_lng},
                    {"type": "WAIT", "stop_id": stop_id, "duration_minutes": round(wait_min, 1)},
                    {"type": "RIDE", "route": route, "headsign": headsign or "", "stop_id": stop_id,
                     "duration_minutes": round(ride_min, 1),
                     "alighting_stop_id": ex_stop_id,
                     "alighting_stop_lat": ex_lat,
                     "alighting_stop_lng": ex_lng},
                    {"type": "WALK_TO_DEST", "building_id": destination_building_id,
                     "duration_minutes": round(walk_from_min, 1), "building_lat": b_lat, "building_lng": b_lng},
                ],
            }))

    # Sort then deduplicate by (route, headsign) — keep best ETA per unique bus
    bus_candidates.sort(key=lambda x: (x[0], x[1]["summary"]))
    seen_route_keys: set[tuple[str, str]] = set()
    deduped: list[tuple[float, dict]] = []
    for score, opt in bus_candidates:
        ride_step = next((s for s in opt.get("steps", []) if s["type"] == "RIDE"), None)
        key = (ride_step.get("route", ""), ride_step.get("headsign", "")) if ride_step else ("", "")
        if key not in seen_route_keys:
            seen_route_keys.add(key)
            deduped.append((score, opt))

    options = [opt for _, opt in deduped[: max_opts - 1 if walk_option else max_opts]]
    if walk_option:
        options.append(walk_option)
    if prefer_bus:
        # Rain mode: bus options first (sorted by eta), walk last
        options.sort(key=lambda o: (1 if o["type"] == "WALK" else 0, o["eta_minutes"]))
    else:
        options.sort(key=lambda o: (o["eta_minutes"], o["summary"]))
    return options[:max_opts]
