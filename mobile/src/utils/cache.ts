import AsyncStorage from '@react-native-async-storage/async-storage';

const TIMETABLE_KEY = '@uiuc_bus_timetable_cache';
const TIMETABLE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const BUILDING_CACHE_KEY = '@uiuc_bus_buildings_cache';
const DEPARTURE_PATTERNS_KEY = '@uiuc_bus_departure_patterns';

interface TimetableCache {
  data: Record<string, any[]>; // stopId -> departures array
  cachedAt: number; // epoch ms
}

interface DeparturePattern {
  stopId: string;
  routeId: string;
  // observed minute-of-day -> count mapping (keyed as "HH:MM")
  observations: Record<string, number>;
  lastUpdated: number;
}

// Save/load static timetable (refreshed weekly)
export async function saveTimetableCache(stopId: string, departures: any[]): Promise<void> {
  try {
    const entry: TimetableCache = {
      data: { [stopId]: departures },
      cachedAt: Date.now(),
    };
    await AsyncStorage.setItem(`${TIMETABLE_KEY}_${stopId}`, JSON.stringify(entry));
  } catch {}
}

export async function loadTimetableCache(stopId: string): Promise<{ data: any[]; isStale: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem(`${TIMETABLE_KEY}_${stopId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimetableCache;
    const isStale = Date.now() - parsed.cachedAt > TIMETABLE_TTL;
    return { data: parsed.data[stopId] ?? [], isStale };
  } catch {
    return null;
  }
}

export async function isTimetableCacheValid(): Promise<boolean> {
  try {
    // Check the generic key for any entry; we read the first key that matches by checking the raw keys
    const keys = await AsyncStorage.getAllKeys();
    const timetableKeys = keys.filter((k) => k.startsWith(TIMETABLE_KEY));
    if (timetableKeys.length === 0) return false;
    const raw = await AsyncStorage.getItem(timetableKeys[0]);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as TimetableCache;
    return Date.now() - parsed.cachedAt <= TIMETABLE_TTL;
  } catch {
    return false;
  }
}

// Save/load building locations (permanent)
export async function saveBuildingsCache(buildings: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(BUILDING_CACHE_KEY, JSON.stringify(buildings));
  } catch {}
}

export async function loadBuildingsCache(): Promise<any[] | null> {
  try {
    const raw = await AsyncStorage.getItem(BUILDING_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as any[];
  } catch {
    return null;
  }
}

// Record departure observation for pattern learning
export async function recordDepartureObservation(
  stopId: string,
  routeId: string,
  timeStr: string
): Promise<void> {
  try {
    const key = `${DEPARTURE_PATTERNS_KEY}_${stopId}_${routeId}`;
    const raw = await AsyncStorage.getItem(key);
    const pattern: DeparturePattern = raw
      ? (JSON.parse(raw) as DeparturePattern)
      : { stopId, routeId, observations: {}, lastUpdated: Date.now() };
    pattern.observations[timeStr] = (pattern.observations[timeStr] ?? 0) + 1;
    pattern.lastUpdated = Date.now();
    await AsyncStorage.setItem(key, JSON.stringify(pattern));
  } catch {}
}

// Get predicted next departure based on observed patterns
export async function getPredictedDepartures(
  stopId: string,
  routeId: string,
  afterTimeStr: string,
  count: number = 3
): Promise<string[]> {
  try {
    const key = `${DEPARTURE_PATTERNS_KEY}_${stopId}_${routeId}`;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const pattern = JSON.parse(raw) as DeparturePattern;
    const times = Object.keys(pattern.observations).sort();
    const after = times.filter((t) => t > afterTimeStr);
    return after.slice(0, count);
  } catch {
    return [];
  }
}
