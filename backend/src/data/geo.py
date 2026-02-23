"""
Haversine distance for geographic nearby queries.
"""
import math

# Earth radius in km (WGS84 approximate)
EARTH_RADIUS_KM = 6371.0


def haversine_distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Return great-circle distance between two points in kilometers.
    Arguments in degrees.
    """
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlng / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_KM * c


def haversine_distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return great-circle distance in meters. Arguments in degrees."""
    return haversine_distance_km(lat1, lng1, lat2, lng2) * 1000.0

