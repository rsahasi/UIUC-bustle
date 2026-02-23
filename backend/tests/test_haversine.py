"""Tests for Haversine distance helper."""
import math
import pytest
from src.data.geo import haversine_distance_km, EARTH_RADIUS_KM


def test_same_point_zero_distance():
    assert haversine_distance_km(40.0, -88.0, 40.0, -88.0) == 0.0


def test_antipodal_roughly_half_circumference():
    # Antipodal points: ~ pi * EARTH_RADIUS_KM
    d = haversine_distance_km(0.0, 0.0, 0.0, 180.0)
    expected = math.pi * EARTH_RADIUS_KM
    assert abs(d - expected) < 1.0


def test_known_distance_uiuc():
    # Champaign to Urbana rough distance ~5 km
    champaign = (40.1164, -88.2434)
    urbana = (40.1106, -88.2073)
    d = haversine_distance_km(champaign[0], champaign[1], urbana[0], urbana[1])
    assert 3.0 < d < 8.0


def test_symmetry():
    d1 = haversine_distance_km(40.1, -88.2, 40.2, -88.1)
    d2 = haversine_distance_km(40.2, -88.1, 40.1, -88.2)
    assert d1 == d2
