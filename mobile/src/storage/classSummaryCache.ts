import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "@uiuc_bus_class_summary_";

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
