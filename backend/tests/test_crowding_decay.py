"""Unit tests for crowding decay algorithm (pure, no DB dependency)."""
from datetime import datetime, timedelta, timezone

import pytest

from src.data.crowding_repo import CrowdingAggregate, _weight, compute_weighted_level


def _ts(minutes_ago: float) -> datetime:
    """Return a timezone-aware datetime for minutes_ago minutes in the past."""
    return datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)


# ---------------------------------------------------------------------------
# _weight tests
# ---------------------------------------------------------------------------

def test_no_reports_returns_none():
    result = compute_weighted_level([])
    assert result is None


def test_single_fresh_report():
    reports = [{"crowding_level": 3, "reported_at": _ts(0)}]
    result = compute_weighted_level(reports)
    assert result is not None
    assert result.level == 3
    assert result.report_count == 1


def test_single_report_returns_low_confidence():
    reports = [{"crowding_level": 2, "reported_at": _ts(5)}]
    result = compute_weighted_level(reports)
    assert result is not None
    assert result.source == "crowdsourced"
    assert result.confidence == "low"


def test_two_reports_medium_confidence():
    reports = [
        {"crowding_level": 3, "reported_at": _ts(1)},
        {"crowding_level": 3, "reported_at": _ts(2)},
    ]
    result = compute_weighted_level(reports)
    assert result is not None
    assert result.level == 3
    assert result.confidence == "medium"


def test_decay_halves_weight_after_20min():
    # One fresh level-4 report (weight 1.0) + one 25-min-old level-1 (weight 0.5)
    # weighted sum = 4*1.0 + 1*0.5 = 4.5, total_weight = 1.5 → 3.0 → level 3
    reports = [
        {"crowding_level": 4, "reported_at": _ts(0)},
        {"crowding_level": 1, "reported_at": _ts(25)},
    ]
    result = compute_weighted_level(reports)
    assert result is not None
    assert result.level == 3


def test_boundary_exactly_20min_gets_full_weight():
    # age just under 20 min: age_min > 20 is False, so weight should be 1.0
    # Use 19 min 50 sec to avoid clock drift between _ts() call and _weight() call.
    r = {"crowding_level": 1, "reported_at": _ts(19.833)}  # ~19 min 50 sec
    assert _weight(r["reported_at"]) == 1.0


def test_boundary_just_over_20min_gets_half_weight():
    # age == 21 min: age_min > 20 is True, > 40 is False → weight 0.5
    r = {"crowding_level": 1, "reported_at": _ts(21)}
    assert _weight(r["reported_at"]) == 0.5


def test_boundary_exactly_40min_gets_half_weight():
    # age just under 40 min: age_min > 40 is False → weight 0.5
    # Use 39 min 50 sec to avoid clock drift between _ts() call and _weight() call.
    r = {"crowding_level": 1, "reported_at": _ts(39.833)}  # ~39 min 50 sec
    assert _weight(r["reported_at"]) == 0.5


def test_boundary_just_over_40min_gets_quarter_weight():
    # age == 41 min: age_min > 40 is True, > 60 is False → weight 0.25
    r = {"crowding_level": 1, "reported_at": _ts(41)}
    assert _weight(r["reported_at"]) == 0.25


def test_reports_older_than_60min_ignored():
    # Both reports are too old; no active reports → None
    reports = [
        {"crowding_level": 3, "reported_at": _ts(65)},
        {"crowding_level": 2, "reported_at": _ts(70)},
    ]
    result = compute_weighted_level(reports)
    assert result is None


def test_quarter_weight_between_40_and_60min():
    # 45-min old report has weight 0.25, still contributes → level 4
    reports = [{"crowding_level": 4, "reported_at": _ts(45)}]
    result = compute_weighted_level(reports)
    assert result is not None
    assert result.level == 4


def test_rounds_to_nearest_level():
    # Two reports: level 3 (weight 1.0) and level 2 (weight 1.0)
    # weighted avg = (3 + 2) / 2 = 2.5 → rounds to 2 or 3 (round() Python uses banker's rounding)
    reports = [
        {"crowding_level": 3, "reported_at": _ts(0)},
        {"crowding_level": 2, "reported_at": _ts(0)},
    ]
    result = compute_weighted_level(reports)
    assert result is not None
    assert result.level in (2, 3)
