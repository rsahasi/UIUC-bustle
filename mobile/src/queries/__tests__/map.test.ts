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

import { useVehicles, useWalkingRoute, useBusRouteStops } from "../map";

beforeEach(() => { jest.clearAllMocks(); });

describe("useVehicles", () => {
  it("returns vehicles", async () => {
    (client.fetchVehicles as jest.Mock).mockResolvedValueOnce({
      vehicles: [{ vehicle_id: "v1", lat: 40.1, lng: -88.2, heading: 90, route_id: "5", headsign: "Lincoln" }],
    });
    const { result } = renderHookWithQuery(() => useVehicles());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.vehicles).toHaveLength(1);
    expect(client.fetchVehicles).toHaveBeenCalledWith("http://test", undefined, { apiKey: null });
  });
});

describe("useWalkingRoute", () => {
  it("returns polyline coords", async () => {
    (client.fetchWalkingRoute as jest.Mock).mockResolvedValueOnce({
      coords: [[40.1, -88.2], [40.11, -88.21]],
    });
    const { result } = renderHookWithQuery(() =>
      useWalkingRoute(40.1, -88.2, 40.11, -88.21)
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.coords).toHaveLength(2);
  });

  it("does not fetch when origin coords are zero", () => {
    const { result } = renderHookWithQuery(() => useWalkingRoute(0, 0, 40.11, -88.21));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useBusRouteStops", () => {
  it("returns stops and shape", async () => {
    (client.fetchBusRouteStops as jest.Mock).mockResolvedValueOnce({
      trip_id: "t1", stops: [], shape_points: [],
    });
    const { result } = renderHookWithQuery(() =>
      useBusRouteStops("5", "IT", "MAIN", "2026-03-17T09:00:00")
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("does not fetch when routeId is empty", () => {
    const { result } = renderHookWithQuery(() =>
      useBusRouteStops("", "IT", "MAIN", "2026-03-17T09:00:00")
    );
    expect(result.current.fetchStatus).toBe("idle");
  });
});
