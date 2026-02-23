import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@uiuc_bus_recent_searches";
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
    const raw = await AsyncStorage.getItem(KEY);
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
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
}

export async function clearRecentSearches(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
