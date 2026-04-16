import * as SecureStore from "expo-secure-store";
import { v4 as uuidv4 } from "uuid";

const DEVICE_ID_KEY = "uiuc_bus_device_id";

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = uuidv4();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}
