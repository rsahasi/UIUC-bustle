import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@uiuc_bus_class_notif_disabled";

/** Returns the set of class_ids for which notifications are muted. */
export async function getDisabledClassIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function disableClassNotif(classId: string): Promise<void> {
  const ids = await getDisabledClassIds();
  if (!ids.includes(classId)) {
    await AsyncStorage.setItem(KEY, JSON.stringify([...ids, classId]));
  }
}

export async function enableClassNotif(classId: string): Promise<void> {
  const ids = (await getDisabledClassIds()).filter((id) => id !== classId);
  await AsyncStorage.setItem(KEY, JSON.stringify(ids));
}

export async function isClassNotifDisabled(classId: string): Promise<boolean> {
  return (await getDisabledClassIds()).includes(classId);
}
