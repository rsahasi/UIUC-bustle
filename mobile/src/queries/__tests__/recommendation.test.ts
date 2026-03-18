import { waitFor } from "@testing-library/react-native";
import { renderHookWithQuery } from "@/src/test-utils/renderWithQuery";
import * as client from "@/src/api/client";
import type { RecommendationRequest } from "@/src/api/types";

jest.mock("@/src/auth/supabaseClient", () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) } }
}));
jest.mock("@/src/api/client");
jest.mock("@/src/hooks/useApiBaseUrl", () => ({
  useApiBaseUrl: () => ({ apiBaseUrl: "http://test", apiKey: null }),
}));

import { useRecommendation } from "../recommendation";

beforeEach(() => { jest.clearAllMocks(); });

const PARAMS: RecommendationRequest = {
  lat: 40.11,
  lng: -88.23,
  destination_building_id: "b1",
  arrive_by_iso: "2026-03-17T10:00:00",
  walking_speed_mps: 1.4,
  buffer_minutes: 5,
  prefer_bus: false,
};

describe("useRecommendation", () => {
  it("returns options when params are provided", async () => {
    (client.fetchRecommendation as jest.Mock).mockResolvedValueOnce({
      options: [{ type: "BUS", summary: "Bus 5", eta_minutes: 12, depart_in_minutes: 3, steps: [] }],
    });
    const { result } = renderHookWithQuery(() => useRecommendation(PARAMS));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.options).toHaveLength(1);
    expect(client.fetchRecommendation).toHaveBeenCalledWith("http://test", PARAMS, { apiKey: null });
  });

  it("does not fetch when params are null", () => {
    const { result } = renderHookWithQuery(() => useRecommendation(null));
    expect(result.current.fetchStatus).toBe("idle");
    expect(client.fetchRecommendation).not.toHaveBeenCalled();
  });

  it("does not fetch when enabled is false", () => {
    const { result } = renderHookWithQuery(() =>
      useRecommendation(PARAMS, { enabled: false })
    );
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("re-fetches when params change", async () => {
    (client.fetchRecommendation as jest.Mock).mockResolvedValue({ options: [] });
    const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
    const { renderHook } = require("@testing-library/react-native");
    const React = require("react");
    const client2 = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: client2 }, children);
    const { result, rerender } = renderHook(
      ({ params }: { params: RecommendationRequest }) => useRecommendation(params),
      { wrapper, initialProps: { params: PARAMS } }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params2 = { ...PARAMS, walking_speed_mps: 1.9 };
    rerender({ params: params2 });
    await waitFor(() => expect(client.fetchRecommendation).toHaveBeenCalledTimes(2));
  });
});
