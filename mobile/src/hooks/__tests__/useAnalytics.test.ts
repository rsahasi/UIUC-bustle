import { renderHook } from "@testing-library/react-native";
import { useAnalytics } from "../useAnalytics";

const mockCapture = jest.fn();

// Mutable so the "SDK not ready" case can return null without
// jest.resetModules(): re-requiring @testing-library inside a test body
// illegally registers its lifecycle hooks.
let mockPostHog: { capture: jest.Mock } | null = { capture: mockCapture };

jest.mock("posthog-react-native", () => ({
  usePostHog: () => mockPostHog,
}));

describe("useAnalytics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPostHog = { capture: mockCapture };
  });

  it("calls posthog.capture with event name and properties", () => {
    const { result } = renderHook(() => useAnalytics());
    result.current.capture("route_viewed", { route_count: 3 });
    expect(mockCapture).toHaveBeenCalledWith("route_viewed", { route_count: 3 });
  });

  it("calls posthog.capture with only event name when no properties", () => {
    const { result } = renderHook(() => useAnalytics());
    result.current.capture("map_viewed");
    expect(mockCapture).toHaveBeenCalledWith("map_viewed", undefined);
  });

  it("does not throw if posthog.capture throws", () => {
    mockCapture.mockImplementationOnce(() => {
      throw new Error("SDK error");
    });
    const { result } = renderHook(() => useAnalytics());
    expect(() => result.current.capture("walk_started")).not.toThrow();
  });

  it("does not throw if posthog is null (SDK not ready)", () => {
    mockPostHog = null;
    const { result } = renderHook(() => useAnalytics());
    expect(() => result.current.capture("trip_completed")).not.toThrow();
  });

  // Callers put `capture` in dependency arrays (useEffect, useFocusEffect).
  // An unstable identity silently turns "run once" into "run every render",
  // which previously caused a share-trip PATCH per render during a bus trip.
  it("returns a stable capture identity across re-renders", () => {
    const { result, rerender } = renderHook(() => useAnalytics());
    const first = result.current.capture;
    rerender({});
    expect(result.current.capture).toBe(first);
  });

  it("returns a stable object identity across re-renders", () => {
    const { result, rerender } = renderHook(() => useAnalytics());
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
  });
});
