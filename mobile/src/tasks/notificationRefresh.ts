import { fetchBuildings, fetchRecommendation } from "@/src/api/client";
import { cancelAllClassReminders, scheduleClassReminders } from "@/src/notifications/classReminders";
import { getStoredApiKey } from "@/src/storage/apiKey";
import { getStoredApiBaseUrl } from "@/src/storage/apiUrl";
import { getClassNotificationsEnabled } from "@/src/storage/classNotifications";
import { getLastKnownHomeData } from "@/src/storage/lastKnownHome";
import { getStoredBufferMinutes, getStoredWalkingMode } from "@/src/storage/recommendationSettings";
import { setClassSummary, setClassRouteData } from "@/src/storage/classSummaryCache";
import { getMpsForMode } from "@/src/constants/walkingMode";
import { buildRouteSummary, formatOptionLabel } from "@/src/utils/routeFormatting";
import { arriveByIsoToday } from "@/src/utils/arriveBy";
import { getNextClassToday } from "@/src/utils/nextClass";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";

export const NOTIFICATION_REFRESH_TASK = "uiuc-notification-refresh";

// Must be defined at module level (outside any component)
TaskManager.defineTask(NOTIFICATION_REFRESH_TASK, async () => {
  try {
    const enabled = await getClassNotificationsEnabled();
    if (!enabled) return BackgroundFetch.BackgroundFetchResult.NoData;

    const [apiBaseUrl, apiKey, walkingModeId, bufferMinutes, lastKnown] = await Promise.all([
      getStoredApiBaseUrl(),
      getStoredApiKey(),
      getStoredWalkingMode(),
      getStoredBufferMinutes(),
      getLastKnownHomeData(),
    ]);

    if (!lastKnown || !lastKnown.scheduleClasses.length) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const walkingSpeedMps = getMpsForMode(walkingModeId);
    const classes = lastKnown.scheduleClasses;
    const nextClass = getNextClassToday(classes);

    // Refresh route data for next class if we have a cached location
    if (nextClass && lastKnown.location) {
      const { lat, lng } = lastKnown.location;
      try {
        const hasCustomDest =
          nextClass.destination_lat != null && nextClass.destination_lng != null;
        const rec = await fetchRecommendation(
          apiBaseUrl,
          {
            lat,
            lng,
            ...(hasCustomDest
              ? {
                  destination_lat: nextClass.destination_lat!,
                  destination_lng: nextClass.destination_lng!,
                  destination_name: nextClass.destination_name ?? "Class",
                }
              : { destination_building_id: nextClass.building_id }),
            arrive_by_iso: arriveByIsoToday(nextClass.start_time_local),
            max_options: 3,
            walking_speed_mps: walkingSpeedMps,
            buffer_minutes: bufferMinutes,
          },
          { apiKey: apiKey ?? undefined }
        );
        const options = rec.options ?? [];
        if (options.length > 0) {
          const summary = buildRouteSummary(options);
          await setClassSummary(nextClass.class_id, summary);
          await setClassRouteData(nextClass.class_id, {
            summary,
            bestDepartInMinutes: Math.min(...options.map((o) => o.depart_in_minutes)),
            etaMinutes: options[0]?.eta_minutes ?? 0,
            options: options.map((o) => ({
              label: formatOptionLabel(o),
              departInMinutes: o.depart_in_minutes,
            })),
          });
        }
      } catch {
        // Graceful fail — still reschedule with previously cached data
      }
    }

    // Fetch building names for notification bodies
    let buildingMap: Record<string, string> = {};
    try {
      const bRes = await fetchBuildings(apiBaseUrl, { apiKey: apiKey ?? undefined });
      for (const b of bRes.buildings ?? []) buildingMap[b.building_id] = b.name;
    } catch {}

    await cancelAllClassReminders();
    await scheduleClassReminders(classes as Parameters<typeof scheduleClassReminders>[0], buildingMap, walkingSpeedMps, bufferMinutes);

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerNotificationRefreshTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(NOTIFICATION_REFRESH_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(NOTIFICATION_REFRESH_TASK, {
        minimumInterval: 15 * 60, // 15 minutes (iOS decides actual frequency)
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch {}
}

export async function unregisterNotificationRefreshTask(): Promise<void> {
  try {
    await BackgroundFetch.unregisterTaskAsync(NOTIFICATION_REFRESH_TASK);
  } catch {}
}
