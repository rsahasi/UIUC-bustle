import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "@uiuc_bus_walked_class_ids_";

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${KEY_PREFIX}${y}-${m}-${d}`;
}

/** Mark that the user is walking to this class today; dismiss further reminders for it. */
export async function markClassAsWalkedToday(classId: string): Promise<void> {
  const key = dateKey(new Date());
  try {
    const raw = await AsyncStorage.getItem(key);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(classId)) ids.push(classId);
    await AsyncStorage.setItem(key, JSON.stringify(ids));
  } catch (_) {}
}

/** Class IDs the user chose "walking" for today (so we don’t send more reminders). */
export async function getWalkedClassIdsToday(date: Date = new Date()): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(dateKey(date));
    if (!raw) return [];
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}
