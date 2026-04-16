import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { v4 as uuidv4 } from "uuid";

const KEY = "crowding_device_token_v1";

/** Returns a stable SHA-256-hashed token for anonymous crowding reports. */
export async function getCrowdingToken(): Promise<string> {
  let raw = await AsyncStorage.getItem(KEY);
  if (!raw) {
    raw = uuidv4();
    await AsyncStorage.setItem(KEY, raw);
  }
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
}
