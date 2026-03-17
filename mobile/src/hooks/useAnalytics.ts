import { usePostHog } from "posthog-react-native";

export function useAnalytics(): {
  capture: (event: string, properties?: Record<string, unknown>) => void;
} {
  const posthog = usePostHog();
  return {
    capture(event: string, properties?: Record<string, unknown>): void {
      try {
        posthog?.capture(event, properties);
      } catch {
        // swallow — analytics must never crash the app
      }
    },
  };
}
