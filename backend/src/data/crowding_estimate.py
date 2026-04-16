from datetime import datetime

_CAMPUS_ROUTES = frozenset({"22", "22S", "22E", "1", "1S", "2", "2S", "13", "13S"})

def estimate_crowding_level(route_id: str, now: datetime) -> dict:
    """Heuristic crowding estimate. Returns dict with level, confidence, source."""
    hour = now.hour
    weekday = now.weekday()  # 0=Mon, 6=Sun
    is_weekend = weekday >= 5
    is_campus = any(route_id.upper().startswith(r) for r in _CAMPUS_ROUTES)

    if hour >= 22 or hour < 2:
        level = 1
    elif hour < 6:
        level = 1
    elif 7 <= hour < 9 and not is_weekend:
        level = 4 if is_campus else 3
    elif 16 <= hour < 18 and not is_weekend:
        level = 4 if is_campus else 3
    elif 9 <= hour < 16 and not is_weekend:
        level = 3 if is_campus else 2
    elif is_weekend and 9 <= hour < 21:
        level = 2
    else:
        level = 1

    return {"level": level, "confidence": "estimated", "source": "estimated"}
