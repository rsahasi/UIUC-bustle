import * as SecureStore from "expo-secure-store";

const KEY = "@uiuc_bus_api_key";

export async function getStoredApiKey(): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    if (v != null && v.trim()) return v.trim();
  } catch (_) {}
  return null;
}

export async function setStoredApiKey(key: string | null): Promise<void> {
  if (key == null || !key.trim()) {
    await SecureStore.deleteItemAsync(KEY);
    return;
  }
  await SecureStore.setItemAsync(KEY, key.trim());
}
