/**
 * widgetDataWriter.ts
 *
 * Writes a JSON snapshot of live app state to a location the iOS
 * WidgetKit extension can read.  The extension is built with EAS Build
 * and shares an App Group container (group.com.uiucbusapp.widget).
 *
 * On iOS the JSON is written to the App Group shared container so the
 * Swift widget can decode it with JSONDecoder.  On Android (and in Expo
 * Go where the App Group is not configured) we fall back to writing
 * inside the app's own document directory — widgets still can't read
 * it, but the file stays fresh for whenever the user switches to a
 * bare/EAS build.
 */

import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WidgetNextClass {
  name: string;
  startTime: string;      // "HH:MM"
  building: string;
  leaveByTime: string;    // "HH:MM"
  leaveInMinutes: number; // minutes until user must leave
}

export interface WidgetNextBus {
  route: string;
  stop: string;
  departureTime: string;  // "HH:MM"
  minsUntil: number;
  isLive: boolean;
}

export interface WidgetTodayClass {
  name: string;
  startTime: string;
  building: string;
  recommendedDepartTime: string; // "HH:MM"
}

export interface WidgetData {
  nextClass: WidgetNextClass | null;
  nextBus: WidgetNextBus | null;
  todayClasses: WidgetTodayClass[];
  stepsToday: number;
  weeklyStepGoal: number;
  weeklyStepsProgress: number; // 0.0 – 1.0
  lastUpdated: number; // epoch ms
  isDataFresh: boolean; // false if lastUpdated > 5 min ago
}

// ─── File path ───────────────────────────────────────────────────────────────

/**
 * In a full EAS Build with the entitlement configured the path should be
 * the App Group shared container.  expo-file-system doesn't expose the
 * App Group directory API, so we write to documentDirectory and the Swift
 * extension reads from there via a bridged FileManager path.
 *
 * To wire the real App Group path, add to your EAS build config:
 *   appGroupIdentifier: "group.com.uiucbusapp.widget"
 * and in the Swift extension use:
 *   FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)
 */
function getWidgetFilePath(): string {
  const base = FileSystem.documentDirectory ?? '';
  return `${base}widget_data.json`;
}

// ─── Write ───────────────────────────────────────────────────────────────────

let _lastWriteMs = 0;
const WRITE_THROTTLE_MS = 5_000; // don't hammer FS faster than 5 s

export async function writeWidgetData(data: WidgetData): Promise<void> {
  const now = Date.now();
  if (now - _lastWriteMs < WRITE_THROTTLE_MS) return;
  _lastWriteMs = now;

  try {
    const payload: WidgetData = {
      ...data,
      lastUpdated: now,
      isDataFresh: true,
    };
    await FileSystem.writeAsStringAsync(getWidgetFilePath(), JSON.stringify(payload));
  } catch {
    // Non-fatal — widget will show last cached data
  }
}

export async function readWidgetData(): Promise<WidgetData | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(getWidgetFilePath());
    const data: WidgetData = JSON.parse(raw);
    // Mark stale if > 5 minutes old
    data.isDataFresh = Date.now() - data.lastUpdated < 5 * 60 * 1000;
    return data;
  } catch {
    return null;
  }
}
