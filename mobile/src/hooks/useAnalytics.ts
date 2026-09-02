import { useCallback, useMemo } from "react";
import { usePostHog } from "posthog-react-native";

/**
 * Analytics facade.
 *
 * Both `capture` and the returned object are memoized. Callers put `capture`
 * in dependency arrays (effects, `useFocusEffect`), so an unstable identity
 * here silently turns "run once" into "run every render" at every call site.
 */
export function useAnalytics(): {
  capture: (event: string, properties?: Record<string, unknown>) => void;
} {
  const posthog = usePostHog();

  const capture = useCallback(
    (event: string, properties?: Record<string, unknown>): void => {
      try {
        posthog?.capture(event, properties as Parameters<typeof posthog.capture>[1]);
      } catch {
        // swallow — analytics must never crash the app
      }
    },
    [posthog],
  );

  return useMemo(() => ({ capture }), [capture]);
}
