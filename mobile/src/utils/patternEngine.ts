import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const DEPARTURE_PATTERNS_KEY = '@uiuc_departure_patterns';
const WALK_TIMES_KEY = '@uiuc_walk_times';
const STOP_PREFS_KEY = '@uiuc_stop_prefs';
const ROUTE_PREFS_KEY = '@uiuc_route_prefs';
const INSIGHTS_DISMISSED_KEY = '@uiuc_insights_dismissed';

// ━━━ Types ━━━

export interface DepartureRecord {
  classId: string;
  actualDepartureEpochMs: number;
  recommendedDepartureEpochMs: number;
  departureStop: string;
  routeTaken: string;
  dayOfWeek: number; // 0=Sun, 6=Sat
  timestamp: number;
}

export interface WalkTimeRecord {
  originKey: string; // "lat,lng" rounded to 3 decimal places
  destinationKey: string;
  originLabel: string;
  destinationLabel: string;
  actualMinutes: number;
  estimatedMinutes: number;
  distanceMeters: number;
  timestamp: number;
}

export interface StopChoiceRecord {
  context: string; // e.g. "to_Siebel" - destination context
  chosenStopId: string;
  chosenStopName: string;
  timestamp: number;
}

export interface RouteChoiceRecord {
  context: string; // e.g. "PAAG_to_Siebel"
  chosenRoute: string;
  alternativeRoutes: string[];
  timestamp: number;
}

// ━━━ Learned insights (computed, not stored) ━━━

export interface WalkTimeInsight {
  originLabel: string;
  destinationLabel: string;
  personalMinutes: number;
  estimatedMinutes: number;
  diffMinutes: number; // positive = faster than estimated
  dataPoints: number;
}

export interface DepartureHabitInsight {
  classId: string;
  avgLatenessMinutes: number; // positive = leaves after recommendation
  dataPoints: number;
}

export interface RoutePreferenceInsight {
  context: string;
  preferredRoute: string;
  dataPoints: number;
}

export interface PatternInsights {
  walkTimeInsights: WalkTimeInsight[];
  departureHabits: DepartureHabitInsight[];
  routePreferences: RoutePreferenceInsight[];
}

// ━━━ Helpers ━━━

export function makeOriginKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

async function loadArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveArray<T>(key: string, arr: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

// ━━━ Recording functions ━━━

export async function recordDeparture(record: DepartureRecord): Promise<void> {
  const arr = await loadArray<DepartureRecord>(DEPARTURE_PATTERNS_KEY);
  arr.push(record);
  await saveArray(DEPARTURE_PATTERNS_KEY, arr.slice(-500));
}

export async function recordWalkTime(record: WalkTimeRecord): Promise<void> {
  const arr = await loadArray<WalkTimeRecord>(WALK_TIMES_KEY);
  arr.push(record);
  await saveArray(WALK_TIMES_KEY, arr.slice(-500));
}

export async function recordStopChoice(record: StopChoiceRecord): Promise<void> {
  const arr = await loadArray<StopChoiceRecord>(STOP_PREFS_KEY);
  arr.push(record);
  await saveArray(STOP_PREFS_KEY, arr.slice(-200));
}

export async function recordRouteChoice(record: RouteChoiceRecord): Promise<void> {
  const arr = await loadArray<RouteChoiceRecord>(ROUTE_PREFS_KEY);
  arr.push(record);
  await saveArray(ROUTE_PREFS_KEY, arr.slice(-200));
}

// ━━━ Reading / computation functions ━━━

export async function getPersonalWalkTime(
  originKey: string,
  destinationKey: string
): Promise<number | null> {
  const arr = await loadArray<WalkTimeRecord>(WALK_TIMES_KEY);
  const matching = arr.filter(
    (r) => r.originKey === originKey && r.destinationKey === destinationKey
  );
  if (matching.length < 3) return null;

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = matching.filter((r) => r.timestamp >= thirtyDaysAgo);
  const older = matching.filter((r) => r.timestamp < thirtyDaysAgo);

  const sumRecent = recent.reduce((s, r) => s + r.actualMinutes, 0);
  const sumOlder = older.reduce((s, r) => s + r.actualMinutes, 0);
  const weightedSum = sumRecent * 2 + sumOlder;
  const weightedCount = recent.length * 2 + older.length;

  return weightedSum / weightedCount;
}

export async function getDepartureHabit(classId: string): Promise<DepartureHabitInsight | null> {
  const arr = await loadArray<DepartureRecord>(DEPARTURE_PATTERNS_KEY);
  const matching = arr.filter((r) => r.classId === classId);
  if (matching.length < 5) return null;

  const totalLateness = matching.reduce((s, r) => {
    const lateness = (r.actualDepartureEpochMs - r.recommendedDepartureEpochMs) / 60000;
    return s + lateness;
  }, 0);

  return {
    classId,
    avgLatenessMinutes: totalLateness / matching.length,
    dataPoints: matching.length,
  };
}

export async function getPreferredRoute(context: string): Promise<string | null> {
  const arr = await loadArray<RouteChoiceRecord>(ROUTE_PREFS_KEY);
  const matching = arr.filter((r) => r.context === context);
  if (matching.length < 3) return null;

  const counts: Record<string, number> = {};
  for (const r of matching) {
    counts[r.chosenRoute] = (counts[r.chosenRoute] ?? 0) + 1;
  }

  const [topRoute, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!topRoute) return null;
  if (topCount < 3) return null;
  if (topCount / matching.length <= 0.5) return null;

  return topRoute;
}

export async function getPreferredStop(context: string): Promise<string | null> {
  const arr = await loadArray<StopChoiceRecord>(STOP_PREFS_KEY);
  const matching = arr.filter((r) => r.context === context);
  if (matching.length < 3) return null;

  const counts: Record<string, { name: string; count: number }> = {};
  for (const r of matching) {
    if (!counts[r.chosenStopId]) {
      counts[r.chosenStopId] = { name: r.chosenStopName, count: 0 };
    }
    counts[r.chosenStopId].count += 1;
  }

  const top = Object.values(counts).sort((a, b) => b.count - a.count)[0];
  if (!top || top.count < 3) return null;

  return top.name;
}

export async function computeAllInsights(): Promise<PatternInsights> {
  const [walkRecords, departureRecords, routeRecords] = await Promise.all([
    loadArray<WalkTimeRecord>(WALK_TIMES_KEY),
    loadArray<DepartureRecord>(DEPARTURE_PATTERNS_KEY),
    loadArray<RouteChoiceRecord>(ROUTE_PREFS_KEY),
  ]);

  // Walk time insights: group by (originKey, destinationKey)
  const walkGroups: Record<string, WalkTimeRecord[]> = {};
  for (const r of walkRecords) {
    const key = `${r.originKey}|||${r.destinationKey}`;
    if (!walkGroups[key]) walkGroups[key] = [];
    walkGroups[key].push(r);
  }

  const walkTimeInsights: WalkTimeInsight[] = [];
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const records of Object.values(walkGroups)) {
    if (records.length < 3) continue;

    const recent = records.filter((r) => r.timestamp >= thirtyDaysAgo);
    const older = records.filter((r) => r.timestamp < thirtyDaysAgo);

    const sumActualRecent = recent.reduce((s, r) => s + r.actualMinutes, 0);
    const sumActualOlder = older.reduce((s, r) => s + r.actualMinutes, 0);
    const weightedCount = recent.length * 2 + older.length;
    const personalMinutes = (sumActualRecent * 2 + sumActualOlder) / weightedCount;

    const avgEstimated =
      records.reduce((s, r) => s + r.estimatedMinutes, 0) / records.length;
    const diffMinutes = avgEstimated - personalMinutes; // positive = faster than estimated

    if (Math.abs(diffMinutes) < 2) continue;

    const sample = records[0];
    walkTimeInsights.push({
      originLabel: sample.originLabel,
      destinationLabel: sample.destinationLabel,
      personalMinutes: Math.round(personalMinutes * 10) / 10,
      estimatedMinutes: Math.round(avgEstimated * 10) / 10,
      diffMinutes: Math.round(diffMinutes * 10) / 10,
      dataPoints: records.length,
    });
  }

  // Departure habit insights: group by classId
  const departureGroups: Record<string, DepartureRecord[]> = {};
  for (const r of departureRecords) {
    if (!departureGroups[r.classId]) departureGroups[r.classId] = [];
    departureGroups[r.classId].push(r);
  }

  const departureHabits: DepartureHabitInsight[] = [];
  for (const [classId, records] of Object.entries(departureGroups)) {
    if (records.length < 5) continue;
    const totalLateness = records.reduce((s, r) => {
      return s + (r.actualDepartureEpochMs - r.recommendedDepartureEpochMs) / 60000;
    }, 0);
    const avgLatenessMinutes = totalLateness / records.length;
    if (Math.abs(avgLatenessMinutes) < 1) continue;
    departureHabits.push({
      classId,
      avgLatenessMinutes: Math.round(avgLatenessMinutes * 10) / 10,
      dataPoints: records.length,
    });
  }

  // Route preference insights: group by context
  const routeGroups: Record<string, RouteChoiceRecord[]> = {};
  for (const r of routeRecords) {
    if (!routeGroups[r.context]) routeGroups[r.context] = [];
    routeGroups[r.context].push(r);
  }

  const routePreferences: RoutePreferenceInsight[] = [];
  for (const [context, records] of Object.entries(routeGroups)) {
    const counts: Record<string, number> = {};
    for (const r of records) {
      counts[r.chosenRoute] = (counts[r.chosenRoute] ?? 0) + 1;
    }
    const [topRoute, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!topRoute) continue;
    if (topCount < 3) continue;
    if (topCount / records.length <= 0.5) continue;
    routePreferences.push({
      context,
      preferredRoute: topRoute,
      dataPoints: topCount,
    });
  }

  return { walkTimeInsights, departureHabits, routePreferences };
}

// ━━━ Insight card management ━━━

export async function dismissInsight(insightKey: string): Promise<void> {
  const dismissed = await getDismissedInsights();
  if (!dismissed.includes(insightKey)) {
    dismissed.push(insightKey);
    await AsyncStorage.setItem(INSIGHTS_DISMISSED_KEY, JSON.stringify(dismissed));
  }
}

export async function getDismissedInsights(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INSIGHTS_DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function resetAllPatterns(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(DEPARTURE_PATTERNS_KEY),
    AsyncStorage.removeItem(WALK_TIMES_KEY),
    AsyncStorage.removeItem(STOP_PREFS_KEY),
    AsyncStorage.removeItem(ROUTE_PREFS_KEY),
    AsyncStorage.removeItem(INSIGHTS_DISMISSED_KEY),
  ]);
}
