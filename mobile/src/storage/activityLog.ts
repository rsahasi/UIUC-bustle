import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WalkingModeId } from "@/src/constants/walkingMode";
import { v4 as uuidv4 } from "uuid";

const KEY = "@uiuc_bus_activity_log";

export interface ActivityEntry {
  id: string;
  date: string; // YYYY-MM-DD local
  walkingModeId: WalkingModeId;
  distanceM: number;
  stepCount: number;
  durationSeconds: number;
  caloriesBurned: number;
  from: string;
  to: string;
}

export async function getActivityLog(): Promise<ActivityEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addActivityEntry(entry: Omit<ActivityEntry, "id">): Promise<ActivityEntry> {
  const log = await getActivityLog();
  const newEntry: ActivityEntry = { ...entry, id: uuidv4() };
  log.push(newEntry);
  // Keep last 365 entries
  const trimmed = log.slice(-365);
  await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
  return newEntry;
}

export async function getActivityForDate(date: string): Promise<ActivityEntry[]> {
  const log = await getActivityLog();
  return log.filter((e) => e.date === date);
}

export function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dateStringForOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Returns the number of consecutive days (ending today) where total steps >= minSteps.
 * A day with no activity at all counts as 0 steps and breaks the streak.
 */
export function calcStreak(log: ActivityEntry[], minSteps = 500): number {
  let streak = 0;
  for (let offset = 0; ; offset++) {
    const dateStr = dateStringForOffset(offset);
    const daySteps = log.filter((e) => e.date === dateStr).reduce((s, e) => s + e.stepCount, 0);
    if (daySteps >= minSteps) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export const WEEKLY_STEP_GOAL = 50_000;

const WEEKLY_GOAL_KEY = '@uiuc_bus_weekly_step_goal';

export async function getWeeklyStepGoal(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(WEEKLY_GOAL_KEY);
    if (!raw) return WEEKLY_STEP_GOAL;
    const n = parseInt(raw, 10);
    return isNaN(n) ? WEEKLY_STEP_GOAL : n;
  } catch {
    return WEEKLY_STEP_GOAL;
  }
}

export async function setWeeklyStepGoal(goal: number): Promise<void> {
  await AsyncStorage.setItem(WEEKLY_GOAL_KEY, String(Math.max(1000, goal)));
}
