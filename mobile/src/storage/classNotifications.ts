import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@uiuc_bus_class_notifications_enabled";

export async function getClassNotificationsEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch (_) {}
  return false;
}

export async function setClassNotificationsEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, enabled ? "true" : "false");
}
