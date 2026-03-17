import { useAnalytics } from "../useAnalytics";

// Mock posthog-react-native before importing
const mockCapture = jest.fn();
jest.mock("posthog-react-native", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}));

describe("useAnalytics", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls posthog.capture with event name and properties", () => {
    const { capture } = useAnalytics();
    capture("route_viewed", { route_count: 3 });
    expect(mockCapture).toHaveBeenCalledWith("route_viewed", { route_count: 3 });
  });

  it("calls posthog.capture with only event name when no properties", () => {
    const { capture } = useAnalytics();
    capture("map_viewed");
    expect(mockCapture).toHaveBeenCalledWith("map_viewed", undefined);
  });

  it("does not throw if posthog.capture throws", () => {
    mockCapture.mockImplementationOnce(() => {
      throw new Error("SDK error");
    });
    const { capture } = useAnalytics();
    expect(() => capture("walk_started")).not.toThrow();
  });

  it("does not throw if posthog is null (SDK not ready)", () => {
    jest.resetModules();
    jest.doMock("posthog-react-native", () => ({
      usePostHog: () => null,
    }));
    // Re-import after mock reset
    const { useAnalytics: ua } = require("../useAnalytics");
    const { capture } = ua();
    expect(() => capture("trip_completed")).not.toThrow();
  });
});
