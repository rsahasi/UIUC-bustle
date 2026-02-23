import { NotificationRedirect } from "@/src/components/NotificationRedirect";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <NotificationRedirect />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="trip" options={{ headerShown: true, title: "Trip", headerBackTitle: "Back" }} />
        <Stack.Screen name="report-issue" options={{ headerShown: true, title: "Report issue", headerBackTitle: "Back" }} />
        <Stack.Screen name="walk-nav" options={{ headerShown: true, title: "Walking Navigation", headerBackTitle: "Back", presentation: "fullScreenModal" }} />
        <Stack.Screen name="after-class-planner" options={{ headerShown: true, title: "Plan my evening", headerBackTitle: "Back", presentation: "modal" }} />
      </Stack>
    </>
  );
}
