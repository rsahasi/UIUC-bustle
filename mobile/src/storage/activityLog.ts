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
