import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WalkingModeId } from "@/src/constants/walkingMode";

const WALKING_KEY = "@uiuc_bus_walking_mode";
const BUFFER_KEY = "@uiuc_bus_buffer_minutes";

const VALID_IDS: WalkingModeId[] = ["walk", "brisk", "speedwalk", "jog"];

const DEFAULT_WALKING: WalkingModeId = "walk";
const DEFAULT_BUFFER = 5;
const MIN_BUFFER = 0;
const MAX_BUFFER = 15;

export async function getStoredWalkingMode(): Promise<WalkingModeId> {
  try {
    const v = await AsyncStorage.getItem(WALKING_KEY);
    if (v != null && (VALID_IDS as string[]).includes(v)) return v as WalkingModeId;
  } catch (_) {}
  return DEFAULT_WALKING;
}

export async function setStoredWalkingMode(mode: WalkingModeId): Promise<void> {
  await AsyncStorage.setItem(WALKING_KEY, mode);
}

export async function getStoredBufferMinutes(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(BUFFER_KEY);
    if (v != null) {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n) && n >= MIN_BUFFER && n <= MAX_BUFFER) return n;
    }
  } catch (_) {}
  return DEFAULT_BUFFER;
}

export async function setStoredBufferMinutes(minutes: number): Promise<void> {
  const clamped = Math.round(Math.max(MIN_BUFFER, Math.min(MAX_BUFFER, minutes)));
  await AsyncStorage.setItem(BUFFER_KEY, String(clamped));
}

export { DEFAULT_WALKING, DEFAULT_BUFFER, MIN_BUFFER, MAX_BUFFER };
