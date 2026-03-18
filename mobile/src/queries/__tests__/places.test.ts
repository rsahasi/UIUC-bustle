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

import { useAutocomplete, usePlacesAutocomplete, usePlaceDetails, useGeocode } from "../places";

beforeEach(() => { jest.clearAllMocks(); });

describe("useAutocomplete", () => {
  it("returns results for 2+ char query", async () => {
    (client.fetchAutocomplete as jest.Mock).mockResolvedValueOnce({
      results: [{ type: "building", name: "Siebel", lat: 40.1, lng: -88.2 }],
    });
    const { result } = renderHookWithQuery(() => useAutocomplete("Si"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toHaveLength(1);
  });

  it("does not fetch for 1-char query", () => {
    const { result } = renderHookWithQuery(() => useAutocomplete("S"));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("usePlacesAutocomplete", () => {
  it("returns predictions for 2+ char query", async () => {
    (client.fetchPlacesAutocomplete as jest.Mock).mockResolvedValueOnce({
      predictions: [{ place_id: "p1", main_text: "Siebel", secondary_text: "Urbana", description: "Siebel, Urbana" }],
    });
    const { result } = renderHookWithQuery(() => usePlacesAutocomplete("Si"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.predictions).toHaveLength(1);
  });

  it("does not fetch for 1-char query", () => {
    const { result } = renderHookWithQuery(() => usePlacesAutocomplete("S"));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("usePlaceDetails", () => {
  it("fetches details for a valid placeId", async () => {
    (client.fetchPlaceDetails as jest.Mock).mockResolvedValueOnce({
      lat: 40.1, lng: -88.2, display_name: "Siebel Center",
    });
    const { result } = renderHookWithQuery(() => usePlaceDetails("p1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.display_name).toBe("Siebel Center");
  });

  it("does not fetch when placeId is null", () => {
    const { result } = renderHookWithQuery(() => usePlaceDetails(null));
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useGeocode", () => {
  it("returns geocode result", async () => {
    (client.fetchGeocode as jest.Mock).mockResolvedValueOnce({
      lat: 40.11, lng: -88.23, display_name: "UIUC Campus",
    });
    const { result } = renderHookWithQuery(() => useGeocode("UIUC"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.display_name).toBe("UIUC Campus");
  });
});
