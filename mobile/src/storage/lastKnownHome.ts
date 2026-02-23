import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@uiuc_bus_last_home";

export interface LastKnownHomeData {
  stops: Array<{ stop_id: string; stop_name: string; lat: number; lng: number; distance_m: number }>;
  departuresByStop: Record<string, Array<{ route: string; headsign: string; expected_mins: number }>>;
  scheduleClasses: Array<{
    class_id: string;
    title: string;
    days_of_week: string[];
    start_time_local: string;
    building_id: string;
  }>;
  recommendations: Array<{
    type: string;
    summary: string;
    eta_minutes: number;
    depart_in_minutes: number;
    steps: unknown[];
  }>;
  savedAt: number;
}

export async function getLastKnownHomeData(): Promise<LastKnownHomeData | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LastKnownHomeData;
    if (!data.stops || !data.scheduleClasses) return null;
    return data;
  } catch {
    return null;
  }
}

export async function setLastKnownHomeData(data: Omit<LastKnownHomeData, "savedAt">): Promise<void> {
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ ...data, savedAt: Date.now() } as LastKnownHomeData)
    );
  } catch (_) {}
}
