import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "@uiuc_bus_class_summary_";
const ROUTE_PREFIX = "@uiuc_bus_class_route_";

export interface ClassRouteData {
  summary: string;
  bestDepartInMinutes: number;
  etaMinutes: number;
  options: Array<{ label: string; departInMinutes: number }>;
}

export async function getClassSummary(classId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(`${PREFIX}${classId}`);
  } catch {
    return null;
  }
}

export async function setClassSummary(classId: string, summary: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${PREFIX}${classId}`, summary);
  } catch {}
}

export async function getClassRouteData(classId: string): Promise<ClassRouteData | null> {
  try {
    const raw = await AsyncStorage.getItem(`${ROUTE_PREFIX}${classId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ClassRouteData;
  } catch {
    return null;
  }
}

export async function setClassRouteData(classId: string, data: ClassRouteData): Promise<void> {
  try {
    await AsyncStorage.setItem(`${ROUTE_PREFIX}${classId}`, JSON.stringify(data));
  } catch {}
}
