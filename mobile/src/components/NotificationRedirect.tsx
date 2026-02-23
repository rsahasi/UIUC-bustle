import { setNotificationHandler } from "@/src/notifications/classReminders";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";

export function NotificationRedirect() {
  const router = useRouter();

  useEffect(() => {
    setNotificationHandler();

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const url =
          (response.notification.request.content.data as { url?: string } | undefined)
            ?.url;
        if (url?.includes("focus=recommendations")) {
          router.replace({
            pathname: "/(tabs)",
            params: { focus: "recommendations" },
          });
        }
      }
    );

    return () => sub.remove();
  }, [router]);

  useLastNotificationRedirect();
  return null;
}

/** Call on app mount to handle cold start from notification tap. */
export function useLastNotificationRedirect(): void {
  const router = useRouter();
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!lastResponse?.notification.request.content.data) return;
    const url = (lastResponse.notification.request.content.data as { url?: string })
      ?.url;
    if (url?.includes("focus=recommendations")) {
      router.replace({
        pathname: "/(tabs)",
        params: { focus: "recommendations" },
      });
    }
  }, [lastResponse, router]);
}
