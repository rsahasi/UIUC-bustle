import type { WalkingModeId } from "@/src/constants/walkingMode";

export const MET_BY_MODE: Record<WalkingModeId, number> = {
  walk: 2.8,
  brisk: 3.5,
  speedwalk: 4.3,
  jog: 7.0,
};

/** Calories burned (kcal). MET × weight (kg) × duration (hours). */
export function calcCalories(met: number, weightKg: number, durationHours: number): number {
  return Math.round(met * weightKg * durationHours * 10) / 10;
}

/** Estimated travel time in seconds. */
export function estimatedTimeSeconds(distanceM: number, speedMps: number): number {
  if (speedMps <= 0) return 0;
  return Math.round(distanceM / speedMps);
}
