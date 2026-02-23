"""
After-class trip planner.
Phase 2: heuristic stub that returns a simple destination sequence.
Phase 3: upgraded to use ClaudeClient.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def heuristic_after_class_plan(
    freetext_plan: str,
    lat: float,
    lng: float,
) -> dict[str, Any]:
    """
    Phase 2 heuristic stub.
    Returns a structured plan with narrative + destination_sequence.
    Each destination_sequence entry: { dest: str, options: [] }
    """
    # Very simple: parse the freetext to extract destination words
    # and suggest walking/bus as placeholders
    plan_lower = freetext_plan.lower()
    destinations: list[str] = []

    keyword_map = {
        "gym": "Campus Recreation Center",
        "library": "Grainger Engineering Library",
        "groceries": "Schnucks Champaign",
        "home": "Home",
        "coffee": "Espresso Royale",
        "food": "Illini Union Food Court",
        "dinner": "Green Street restaurants",
        "study": "Main Library",
    }

    for kw, place in keyword_map.items():
        if kw in plan_lower and place not in destinations:
            destinations.append(place)

    if not destinations:
        # Use the freetext as-is
        destinations = [freetext_plan.strip().title()]

    destination_sequence = [
        {"dest": dest, "options": []} for dest in destinations
    ]

    narrative = (
        f"Here's a plan for your evening: {', then '.join(destinations)}. "
        "Set up your Claude API key to get personalized AI-powered recommendations."
    )

    return {
        "narrative": narrative,
        "destination_sequence": destination_sequence,
    }
