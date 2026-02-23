import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@uiuc_bus_api_key";

export async function getStoredApiKey(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v != null && v.trim()) return v.trim();
  } catch (_) {}
  return null;
}

export async function setStoredApiKey(key: string | null): Promise<void> {
  if (key == null || !key.trim()) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(KEY, key.trim());
}
