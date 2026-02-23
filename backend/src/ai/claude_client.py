"""
Claude AI client for UIUC Bus App.
Wraps anthropic.Anthropic to provide domain-specific AI capabilities.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"


class ClaudeClient:
    def __init__(self, api_key: str):
        import anthropic
        self._client = anthropic.Anthropic(api_key=api_key)

    def _ask(self, system: str, user: str, max_tokens: int = 512) -> str:
        """Make a single Claude call and return the text response."""
        msg = self._client.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text if msg.content else ""

    def get_best_route(
        self,
        origin: str,
        destination: str,
        route_options: list[dict[str, Any]],
        user_context: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Rank route options and return ai_explanation for the best one.
        Returns: { ranked_options: [...], ai_explanation: str }
        """
        system = (
            "You are a campus transit assistant for UIUC. Given route options "
            "to a destination, rank them and explain the best choice concisely. "
            "Respond ONLY with valid JSON: {\"ranked_order\": [0,1,2], \"ai_explanation\": \"...\"}. "
            "Keep ai_explanation under 100 chars."
        )
        user = (
            f"Origin: {origin}\nDestination: {destination}\n"
            f"Context: {json.dumps(user_context)}\n"
            f"Options:\n{json.dumps(route_options, indent=2)}"
        )
        try:
            raw = self._ask(system, user, max_tokens=256)
            data = json.loads(raw)
            return {
                "ranked_order": data.get("ranked_order", list(range(len(route_options)))),
                "ai_explanation": data.get("ai_explanation", ""),
            }
        except Exception as e:
            logger.warning("claude_get_best_route_error error=%s", str(e))
            return {
                "ranked_order": list(range(len(route_options))),
                "ai_explanation": "",
            }

    def get_after_class_plan(
        self,
        freetext_plan: str,
        completed_classes: list[dict],
        available_routes: list[dict],
        activity_today: list[dict],
    ) -> dict[str, Any]:
        """
        Return a structured evening plan.
        Returns: { narrative: str, destination_sequence: [{dest, options}] }
        """
        system = (
            "You are a helpful campus life assistant for UIUC students. "
            "Given a student's evening plans, create a logical destination sequence. "
            "Respond ONLY with valid JSON: "
            "{\"narrative\": \"...\", \"destination_sequence\": [{\"dest\": \"...\", \"options\": []}]}."
        )
        user = (
            f"Student's plan: \"{freetext_plan}\"\n"
            f"Classes completed today: {json.dumps(completed_classes)}\n"
            f"Activity today: {json.dumps(activity_today)}"
        )
        try:
            raw = self._ask(system, user, max_tokens=512)
            data = json.loads(raw)
            return {
                "narrative": data.get("narrative", ""),
                "destination_sequence": data.get("destination_sequence", []),
            }
        except Exception as e:
            logger.warning("claude_after_class_plan_error error=%s", str(e))
            return {
                "narrative": f"Here's a plan for: {freetext_plan}",
                "destination_sequence": [{"dest": freetext_plan, "options": []}],
            }

    def get_eod_activity_report(
        self,
        activity_entries: list[dict],
        walking_mode: str,
        total_stats: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Return an end-of-day activity report.
        Returns: { report: str, encouragement: str, highlights: [str] }
        """
        system = (
            "You are an encouraging fitness coach for a UIUC student. "
            "Summarize their walking activity for the day warmly and motivationally. "
            "Respond ONLY with valid JSON: "
            "{\"report\": \"...\", \"encouragement\": \"...\", \"highlights\": [\"...\"]}."
        )
        steps = total_stats.get("steps", 0)
        calories = total_stats.get("calories", 0)
        distance_m = total_stats.get("distance_m", 0)
        user = (
            f"Today's activity: {len(activity_entries)} walks, "
            f"{steps} steps, {calories:.0f} kcal burned, {distance_m:.0f} m walked.\n"
            f"Walks: {json.dumps(activity_entries[:5])}"
        )
        try:
            raw = self._ask(system, user, max_tokens=400)
            data = json.loads(raw)
            return {
                "report": data.get("report", ""),
                "encouragement": data.get("encouragement", ""),
                "highlights": data.get("highlights", []),
            }
        except Exception as e:
            logger.warning("claude_eod_report_error error=%s", str(e))
            return {
                "report": f"You walked {distance_m:.0f} m, burned {calories:.0f} kcal, and took {steps} steps today!",
                "encouragement": "Keep up the great work!",
                "highlights": [],
            }

    def get_walk_encouragement(
        self,
        mode: str,
        distance_m: float,
        calories: float,
        dest_name: str,
    ) -> str:
        """Return a short one-liner encouragement after completing a walk."""
        system = (
            "You are an upbeat campus fitness coach. "
            "Give a single short encouraging sentence (under 80 chars) after a student completes a walk. "
            "Respond with just the sentence, no quotes."
        )
        user = (
            f"Student completed a {mode} walk of {distance_m:.0f} m to {dest_name}, "
            f"burning {calories:.1f} kcal."
        )
        try:
            return self._ask(system, user, max_tokens=60).strip()
        except Exception as e:
            logger.warning("claude_walk_encouragement_error error=%s", str(e))
            return f"Great job walking to {dest_name}!"
