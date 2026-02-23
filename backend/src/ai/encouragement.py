"""
Walk completion encouragement using Claude.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def get_walk_encouragement(
    mode: str,
    distance_m: float,
    calories: float,
    dest_name: str,
) -> str:
    """
    Return a short encouragement message after a walk.
    Falls back to a default message if Claude is unavailable.
    """
    from settings import get_settings
    settings = get_settings()
    claude_key = getattr(settings, "claude_api_key", "")
    if not claude_key:
        return f"Great job walking to {dest_name}!"
    try:
        from src.ai.claude_client import ClaudeClient
        client = ClaudeClient(api_key=claude_key)
        return client.get_walk_encouragement(
            mode=mode,
            distance_m=distance_m,
            calories=calories,
            dest_name=dest_name,
        )
    except Exception as e:
        logger.warning("encouragement_error error=%s", str(e))
        return f"Great job walking to {dest_name}!"
