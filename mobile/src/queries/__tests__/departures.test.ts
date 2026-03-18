import { waitFor } from "@testing-library/react-native";
import { renderHookWithQuery } from "@/src/test-utils/renderWithQuery";
import * as client from "@/src/api/client";

jest.mock("@/src/auth/supabaseClient", () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) } }
}));
jest.mock("@/src/api/client");
jest.mock("@/src/hooks/useApiBaseUrl", () => ({
  useApiBaseUrl: () => ({ apiBaseUrl: "http://test", apiKey: null }),
}));

import { useDepartures, useNearbyStops } from "../departures";

beforeEach(() => { jest.clearAllMocks(); });

describe("useDepartures", () => {
  it("returns departures for a stop", async () => {
    (client.fetchDepartures as jest.Mock).mockResolvedValueOnce({
      stop_id: "IT",
      departures: [{ route: "5", headsign: "Lincoln Square", expected_mins: 3, expected_time_iso: null, is_realtime: true }],
    });
    const { result } = renderHookWithQuery(() => useDepartures("IT"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.departures).toHaveLength(1);
    expect(client.fetchDepartures).toHaveBeenCalledWith("http://test", "IT", 60, { apiKey: null });
  });

  it("does not fetch when enabled is false", () => {
    const { result } = renderHookWithQuery(() => useDepartures("IT", { enabled: false }));
    expect(result.current.fetchStatus).toBe("idle");
    expect(client.fetchDepartures).not.toHaveBeenCalled();
  });

  it("does not fetch when stopId is empty", () => {
    const { result } = renderHookWithQuery(() => useDepartures(""));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useNearbyStops", () => {
  it("returns stops for given coordinates", async () => {
    (client.fetchNearbyStops as jest.Mock).mockResolvedValueOnce({
      stops: [{ stop_id: "IT", stop_name: "Illinois Terminal", lat: 40.11, lng: -88.23 }],
    });
    const { result } = renderHookWithQuery(() => useNearbyStops(40.11, -88.23));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.stops).toHaveLength(1);
    expect(client.fetchNearbyStops).toHaveBeenCalledWith("http://test", 40.11, -88.23, 800, { apiKey: null });
  });

  it("does not fetch when lat/lng are 0", () => {
    const { result } = renderHookWithQuery(() => useNearbyStops(0, 0));
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("does not fetch when enabled is false", () => {
    const { result } = renderHookWithQuery(() => useNearbyStops(40.11, -88.23, { enabled: false }));
    expect(result.current.fetchStatus).toBe("idle");
  });
});
