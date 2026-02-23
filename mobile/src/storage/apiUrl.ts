import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@uiuc_bus_api_base_url";

const DEFAULT =
  (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_API_BASE_URL?.trim()) ||
  "http://localhost:8000";

export async function getStoredApiBaseUrl(): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v != null && v.trim()) return v.trim().replace(/\/$/, "");
  } catch (_) {}
  return DEFAULT.replace(/\/$/, "");
}

export async function setStoredApiBaseUrl(url: string): Promise<void> {
  const value = url.trim().replace(/\/$/, "") || DEFAULT;
  await AsyncStorage.setItem(KEY, value);
}
