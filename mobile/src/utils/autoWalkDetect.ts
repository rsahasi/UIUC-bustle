import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const AUTO_WALK_TASK = 'auto-walk-detect';
const MIN_WALK_DURATION_S = 120; // 2 minutes
const WALK_MIN_SPEED = 0.9; // m/s (~2 mph)
const WALK_MAX_SPEED = 2.5; // m/s (~5.5 mph)

// Pending auto-detected walk state stored in AsyncStorage
const PENDING_WALK_KEY = '@uiuc_bus_pending_auto_walk';

export interface PendingWalk {
  startEpochMs: number;
  endEpochMs: number;
  distanceM: number;
  stepCount: number; // estimated from distance (1 step ≈ 0.75m)
  detectedAt: number;
}

export async function startAutoWalkDetection(): Promise<void> {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') return;

  const isRegistered = await TaskManager.isTaskRegisteredAsync(AUTO_WALK_TASK);
  if (!isRegistered) return; // task must be defined at top level

  await Location.startLocationUpdatesAsync(AUTO_WALK_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30000, // 30s
    distanceInterval: 50, // 50m
    foregroundService: {
      notificationTitle: 'Walk detection active',
      notificationBody: 'Detecting walks automatically',
    },
    pausesUpdatesAutomatically: true,
  });
}

export async function stopAutoWalkDetection(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(AUTO_WALK_TASK);
  if (started) await Location.stopLocationUpdatesAsync(AUTO_WALK_TASK);
}

export async function getPendingAutoWalk(): Promise<PendingWalk | null> {
  const raw = await AsyncStorage.getItem(PENDING_WALK_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearPendingAutoWalk(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_WALK_KEY);
}

export async function savePendingAutoWalk(walk: PendingWalk): Promise<void> {
  await AsyncStorage.setItem(PENDING_WALK_KEY, JSON.stringify(walk));
}

// Define the background task — must be called at module level (outside component)
// The actual TaskManager.defineTask registration happens in _layout.tsx
export const AUTO_WALK_TASK_NAME = AUTO_WALK_TASK;
