/**
 * widgetRefresh.ts
 *
 * Assembles the WidgetData snapshot from cached storage and writes it
 * to the shared file so the iOS widget extension can read fresh data.
 *
 * Called:
 *   1. App comes to foreground (AppState 'active')
 *   2. Every background fetch cycle (inside notificationRefresh task)
 *   3. After a new walk is logged (walk-nav.tsx on completion)
 */

import { getActivityForDate, getActivityLog, todayDateString, WEEKLY_STEP_GOAL } from '@/src/storage/activityLog';
import { getLastKnownHomeData } from '@/src/storage/lastKnownHome';
import { getStoredApiKey } from '@/src/storage/apiKey';
import { getStoredApiBaseUrl } from '@/src/storage/apiUrl';
import { getStoredBufferMinutes, getStoredWalkingMode } from '@/src/storage/recommendationSettings';
import { getMpsForMode } from '@/src/constants/walkingMode';
import { fetchRecommendation, fetchClasses } from '@/src/api/client';
import { arriveByIsoToday } from '@/src/utils/arriveBy';
import { getNextClassToday } from '@/src/utils/nextClass';
import type { ScheduleClass } from '@/src/api/types';
import { writeWidgetData, type WidgetData, type WidgetTodayClass } from '@/src/utils/widgetDataWriter';

function padTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function departTimeFromDepart(startTime: string, departInMins: number): string {
  const [sh, sm] = startTime.split(':').map(Number);
  const total = (sh ?? 0) * 60 + (sm ?? 0) - Math.round(departInMins);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return padTime(Math.floor(wrapped / 60), wrapped % 60);
}

function leaveInMinutes(startTime: string, departInMins: number): number {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = startTime.split(':').map(Number);
  const classMins = (sh ?? 0) * 60 + (sm ?? 0);
  return classMins - Math.round(departInMins) - nowMins;
}

export async function refreshWidgetData(): Promise<void> {
  try {
    const [apiBaseUrl, apiKey, walkingModeId, bufferMinutes, lastKnown] = await Promise.all([
      getStoredApiBaseUrl(),
      getStoredApiKey(),
      getStoredWalkingMode(),
      getStoredBufferMinutes(),
      getLastKnownHomeData(),
    ]);

    const walkingSpeedMps = getMpsForMode(walkingModeId);

    // Steps
    const today = todayDateString();
    const [todayEntries, fullLog] = await Promise.all([
      getActivityForDate(today),
      getActivityLog(),
    ]);
    const stepsToday = todayEntries.reduce((s, e) => s + e.stepCount, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const weeklySteps = fullLog
      .filter((e) => new Date(e.date + 'T00:00:00') >= weekStart)
      .reduce((s, e) => s + e.stepCount, 0);

    // Classes
    let classes: ScheduleClass[] = lastKnown?.scheduleClasses ?? [];
    if (!classes.length) {
      try {
        const res = await fetchClasses(apiBaseUrl, { apiKey: apiKey ?? undefined });
        classes = res.classes ?? [];
      } catch {}
    }

    const now = new Date();
    const nextClass = getNextClassToday(classes, now);

    // Today's class list (all classes today, sorted by start time)
    const today_day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()] ?? '';
    const todayClasses = classes
      .filter((c) => c.days_of_week.includes(today_day))
      .sort((a, b) => a.start_time_local.localeCompare(b.start_time_local));

    // Build today class entries with recommended depart times (use 15min estimate if no route data)
    const todayClassEntries: WidgetTodayClass[] = todayClasses.map((c) => ({
      name: c.title,
      startTime: c.start_time_local,
      building: c.destination_name ?? c.building_id,
      recommendedDepartTime: departTimeFromDepart(c.start_time_local, 15),
    }));

    let widgetNextClass: WidgetData['nextClass'] = null;
    let widgetNextBus: WidgetData['nextBus'] = null;

    if (nextClass) {
      const loc = lastKnown?.location ?? { lat: 40.102, lng: -88.2272 };
      try {
        const hasCustomDest =
          nextClass.destination_lat != null && nextClass.destination_lng != null;
        const rec = await fetchRecommendation(
          apiBaseUrl,
          {
            lat: loc.lat,
            lng: loc.lng,
            ...(hasCustomDest
              ? {
                  destination_lat: nextClass.destination_lat!,
                  destination_lng: nextClass.destination_lng!,
                  destination_name: nextClass.destination_name ?? 'Class',
                }
              : { destination_building_id: nextClass.building_id }),
            arrive_by_iso: arriveByIsoToday(nextClass.start_time_local),
            walking_speed_mps: walkingSpeedMps,
            buffer_minutes: bufferMinutes,
            max_options: 2,
          },
          { apiKey: apiKey ?? undefined }
        );

        const bestOpt = rec.options?.[0];
        if (bestOpt) {
          const leaveIn = leaveInMinutes(nextClass.start_time_local, bestOpt.depart_in_minutes);
          const departT = departTimeFromDepart(nextClass.start_time_local, bestOpt.depart_in_minutes);
          widgetNextClass = {
            name: nextClass.title,
            startTime: nextClass.start_time_local,
            building: nextClass.destination_name ?? nextClass.building_id,
            leaveByTime: departT,
            leaveInMinutes: leaveIn,
          };

          const rideStep = bestOpt.steps.find((s) => s.type === 'RIDE');
          const walkStep = bestOpt.steps.find((s) => s.type === 'WALK_TO_STOP');
          if (rideStep) {
            const deptEpoch = Date.now() + bestOpt.depart_in_minutes * 60 * 1000;
            const dh = new Date(deptEpoch).getHours();
            const dm = new Date(deptEpoch).getMinutes();
            widgetNextBus = {
              route: rideStep.route ?? '',
              stop: walkStep?.stop_name ?? rideStep.stop_name ?? '',
              departureTime: padTime(dh, dm),
              minsUntil: Math.max(0, Math.round(bestOpt.depart_in_minutes)),
              isLive: true,
            };
          }
        }
      } catch {
        // No route data — still show class without bus info
        widgetNextClass = {
          name: nextClass.title,
          startTime: nextClass.start_time_local,
          building: nextClass.destination_name ?? nextClass.building_id,
          leaveByTime: departTimeFromDepart(nextClass.start_time_local, 15),
          leaveInMinutes: leaveInMinutes(nextClass.start_time_local, 15),
        };
      }
    }

    const payload: WidgetData = {
      nextClass: widgetNextClass,
      nextBus: widgetNextBus,
      todayClasses: todayClassEntries,
      stepsToday,
      weeklyStepGoal: WEEKLY_STEP_GOAL,
      weeklyStepsProgress: Math.min(1, weeklySteps / WEEKLY_STEP_GOAL),
      lastUpdated: Date.now(),
      isDataFresh: true,
    };

    await writeWidgetData(payload);
  } catch {
    // Non-fatal
  }
}
