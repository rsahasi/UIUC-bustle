import type { ScheduleClass } from "@/src/api/types";
import { getClassSummary } from "@/src/storage/classSummaryCache";
import { getWalkedClassIdsToday } from "@/src/storage/walkedClassToday";
import { getTodayCode } from "@/src/utils/nextClass";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const CLASS_REMINDER_PREFIX = "class-";
const CLASS_DEPART_PREFIX = "class-depart-";
const DEEP_LINK_PATH = "/(tabs)?focus=recommendations";
const REMINDER_MINUTES_BEFORE = 20;

/** Ensure we can present notifications when app is in foreground. */
export function setNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
    }),
  });
}

/** Create default channel for Android so scheduled notifications show. */
async function ensureChannel(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("class-reminders", {
      name: "Class reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: undefined,
    });
  }
}

/**
 * Request notification permission. Call when user first enables class notifications
 * (e.g. in Settings) or during onboarding.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannel();
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/** Get classes that occur today (by device local weekday). */
export function getTodayClasses(
  classes: ScheduleClass[],
  now: Date = new Date()
): ScheduleClass[] {
  const today = getTodayCode(now);
  return classes
    .filter((c) => c.days_of_week?.includes(today))
    .sort((a, b) => {
      const [ah, am] = a.start_time_local.split(":").map(Number);
      const [bh, bm] = b.start_time_local.split(":").map(Number);
      return (ah ?? 0) * 60 + (am ?? 0) - (bh ?? 0) * 60 - (bm ?? 0);
    });
}

/**
 * Build trigger Date for (class start - offsetMinutes) in local time.
 * Returns null if that time is in the past.
 */
function triggerDateForClass(
  startTimeLocal: string,
  offsetMinutes: number,
  now: Date = new Date()
): Date | null {
  const [h, m] = startTimeLocal.split(":").map(Number);
  if (h == null || m == null || Number.isNaN(h) || Number.isNaN(m)) return null;
  const classStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    h,
    m,
    0,
    0
  );
  const trigger = new Date(classStart.getTime() - offsetMinutes * 60 * 1000);
  if (trigger.getTime() <= now.getTime()) return null;
  return trigger;
}

/**
 * Schedule local notifications per class today:
 * 1. At class_time - 20min with route summary embedded.
 * 2. A "Leave now" reminder at class_start - eta - 2min (if eta known from summary).
 * Skips classes the user chose "walking" for today.
 */
export async function scheduleClassReminders(
  classes: ScheduleClass[],
  buildingIdToName: Record<string, string> = {}
): Promise<void> {
  await ensureChannel();
  const now = new Date();
  const walkedIds = await getWalkedClassIdsToday(now);
  const todayClasses = getTodayClasses(classes, now).filter(
    (c) => !walkedIds.includes(c.class_id)
  );

  for (const c of todayClasses) {
    const triggerAt = triggerDateForClass(c.start_time_local, REMINDER_MINUTES_BEFORE, now);
    if (!triggerAt) continue;

    const buildingName =
      (c.building_id === "custom" && c.destination_name)
        ? c.destination_name
        : (buildingIdToName[c.building_id] ?? c.building_id);

    // Try to get cached route summary; fall back to generic body
    const summary = await getClassSummary(c.class_id);
    const body = summary
      ? `${buildingName} · ${summary}`
      : `Next class at ${c.start_time_local} in ${buildingName}. Open for best route options.`;

    await Notifications.scheduleNotificationAsync({
      identifier: `${CLASS_REMINDER_PREFIX}${c.class_id}`,
      content: {
        title: c.title,
        body,
        data: { url: DEEP_LINK_PATH },
      },
      trigger: triggerAt as unknown as Notifications.NotificationTriggerInput,
    });

    // Second "Leave now" reminder: parse eta_minutes from summary string
    // Summary format: "Bus 22 in 4 min OR walk 12 min" — try extracting earliest number
    if (summary) {
      const nums = summary.match(/\d+/g);
      const etaMinutes = nums ? Math.min(...nums.map(Number)) : null;
      if (etaMinutes != null && etaMinutes > 0) {
        const departOffset = etaMinutes + 2;
        const departTrigger = triggerDateForClass(c.start_time_local, departOffset, now);
        if (departTrigger) {
          await Notifications.scheduleNotificationAsync({
            identifier: `${CLASS_DEPART_PREFIX}${c.class_id}`,
            content: {
              title: `Leave now for ${c.title}`,
              body: summary,
              data: { url: DEEP_LINK_PATH },
            },
            trigger: departTrigger as unknown as Notifications.NotificationTriggerInput,
          });
        }
      }
    }
  }
}

/** Cancel all scheduled notifications that are class reminders. */
export async function cancelAllClassReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const req of scheduled) {
    if (
      req.identifier.startsWith(CLASS_REMINDER_PREFIX) ||
      req.identifier.startsWith(CLASS_DEPART_PREFIX)
    ) {
      await Notifications.cancelScheduledNotificationAsync(req.identifier);
    }
  }
}

/** Cancel the reminder for one class (e.g. when user taps "I'm walking to this class"). */
export async function cancelClassReminder(classId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`${CLASS_REMINDER_PREFIX}${classId}`);
  await Notifications.cancelScheduledNotificationAsync(`${CLASS_DEPART_PREFIX}${classId}`);
}

/** Schedule a one-off test notification in 3 seconds. Use for "Send test notification" in Settings. */
export async function sendTestNotification(): Promise<void> {
  await ensureChannel();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    const { status: requested } = await Notifications.requestPermissionsAsync();
    if (requested !== "granted") throw new Error("Notification permission denied.");
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "UIUC Bus",
      body: "Test notification — if you see this, reminders will work for your classes.",
      data: {},
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
  });
}
