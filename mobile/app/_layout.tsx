import { NotificationRedirect } from "@/src/components/NotificationRedirect";
import "@/src/tasks/notificationRefresh"; // registers defineTask at module level
import { registerNotificationRefreshTask } from "@/src/tasks/notificationRefresh";
import { AUTO_WALK_TASK_NAME } from '@/src/utils/autoWalkDetect';
import { refreshWidgetData } from '@/src/tasks/widgetRefresh';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as TaskManager from 'expo-task-manager';
import { useEffect } from "react";
import * as Sentry from "@sentry/react-native";
import { PostHogProvider, usePostHog } from "posthog-react-native";
import { getOrCreateDeviceId } from "@/src/utils/deviceId";

// Sentry — init before anything else; no-ops silently when DSN is absent
if (process.env.NODE_ENV !== "test" && process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

TaskManager.defineTask(AUTO_WALK_TASK_NAME, async ({ data, error }: any) => {
  if (error || !data?.locations?.length) return;
  const locations: any[] = data.locations;

  // Simple heuristic: if speed in walk range for 2+ consecutive updates → save pending walk
  const walkLocations = locations.filter(
    (l) => l.coords.speed != null && l.coords.speed >= 0.9 && l.coords.speed <= 2.5
  );

  if (walkLocations.length >= 2) {
    const first = walkLocations[0];
    const last = walkLocations[walkLocations.length - 1];
    const durationS = (last.timestamp - first.timestamp) / 1000;
    if (durationS >= 120) {
      // Estimate distance from speed * time
      const distanceM = walkLocations.reduce((acc, l, i) => {
        if (i === 0) return acc;
        return acc + (l.coords.speed ?? 1.2) * ((l.timestamp - walkLocations[i - 1].timestamp) / 1000);
      }, 0);

      const pending = {
        startEpochMs: first.timestamp,
        endEpochMs: last.timestamp,
        distanceM,
        stepCount: Math.round(distanceM / 0.75),
        detectedAt: Date.now(),
      };
      await AsyncStorage.setItem('@uiuc_bus_pending_auto_walk', JSON.stringify(pending));
    }
  }
});

SplashScreen.preventAutoHideAsync();

/** Identifies the device in both Sentry and PostHog on first mount. */
function AnalyticsIdentifier() {
  const posthog = usePostHog();
  useEffect(() => {
    getOrCreateDeviceId().then((deviceId) => {
      // PostHog: set stable distinct_id; after Supabase, swap to posthog.identify(user.id)
      posthog?.identify(deviceId);
      // Sentry: tag errors with same device ID
      if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
        Sentry.setUser({ id: deviceId });
      }
    });
  }, [posthog]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSerifDisplay_400Regular,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  useEffect(() => {
    registerNotificationRefreshTask();
    // Write widget data on mount and every time app comes to foreground
    refreshWidgetData();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshWidgetData();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;

  return (
    <PostHogProvider
      apiKey={posthogKey || ""}
      options={{
        host: "https://us.i.posthog.com",
        disabled: !posthogKey || process.env.NODE_ENV === "test",
      }}
    >
      <AnalyticsIdentifier />
      <>
        <StatusBar style="light" />
        <NotificationRedirect />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="trip" options={{ headerShown: true, title: "Trip", headerBackTitle: "Back" }} />
          <Stack.Screen name="report-issue" options={{ headerShown: true, title: "Report issue", headerBackTitle: "Back" }} />
          <Stack.Screen name="walk-nav" options={{ headerShown: true, title: "Walking Navigation", headerBackTitle: "Back", presentation: "fullScreenModal" }} />
          <Stack.Screen name="after-class-planner" options={{ headerShown: true, title: "Plan my evening", headerBackTitle: "Back", presentation: "modal" }} />
          <Stack.Screen name="route-tracker" options={{ headerShown: true, title: "Route", headerBackTitle: "Back" }} />
        </Stack>
      </>
    </PostHogProvider>
  );
}
