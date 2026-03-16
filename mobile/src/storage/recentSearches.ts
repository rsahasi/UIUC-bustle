// Recent searches store lat/lng coordinates — use SecureStore (encrypted at rest)
// instead of AsyncStorage (plaintext on-disk).
import * as SecureStore from "expo-secure-store";

const KEY = "uiuc_bus_recent_searches";
const MAX_SEARCHES = 5;

export interface RecentSearch {
  query: string;
  displayName: string;
  lat: number;
  lng: number;
  timestamp: number;
}

export async function getRecentSearches(): Promise<RecentSearch[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addRecentSearch(search: Omit<RecentSearch, "timestamp">): Promise<void> {
  const existing = await getRecentSearches();
  // Remove duplicate queries (case-insensitive)
  const filtered = existing.filter(
    (s) => s.query.toLowerCase() !== search.query.toLowerCase()
  );
  const updated = [{ ...search, timestamp: Date.now() }, ...filtered].slice(0, MAX_SEARCHES);
  await SecureStore.setItemAsync(KEY, JSON.stringify(updated));
}

export async function clearRecentSearches(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
