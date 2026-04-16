import { waitFor } from "@testing-library/react-native";
import { renderHookWithQuery } from "@/src/test-utils/renderWithQuery";
import * as client from "@/src/api/client";

jest.mock("@/src/auth/supabaseClient", () => ({
  supabase: { auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }), refreshSession: jest.fn(), signOut: jest.fn() } },
}));
jest.mock("@/src/api/client");
jest.mock("@/src/hooks/useApiBaseUrl", () => ({
  useApiBaseUrl: () => ({
    apiBaseUrl: "http://test",
    apiKey: null,
    setApiBaseUrl: jest.fn(),
    setApiKey: jest.fn(),
    refresh: jest.fn(),
  }),
}));

import * as schedule from "../schedule";

beforeEach(() => {
  jest.clearAllMocks();
});

// Alias for compatibility with test structure below
const getHooks = () => schedule;

describe("useClasses", () => {
  it("returns classes from API on success", async () => {
    (client.fetchClasses as jest.Mock).mockResolvedValueOnce({
      classes: [{ class_id: "c1", title: "CS 101", days_of_week: ["MON"], start_time_local: "09:00", building_id: "b1" }],
    });
    const { useClasses } = getHooks();
    const { result } = renderHookWithQuery(() => useClasses());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.classes).toHaveLength(1);
    expect(result.current.data?.classes[0].title).toBe("CS 101");
  });

  it("is in loading state before fetch completes", async () => {
    (client.fetchClasses as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { useClasses } = getHooks();
    const { result } = renderHookWithQuery(() => useClasses());
    expect(result.current.isLoading).toBe(true);
  });

  it("exposes isError when fetch rejects", async () => {
    (client.fetchClasses as jest.Mock).mockRejectedValueOnce(new Error("network error"));
    const { useClasses } = getHooks();
    const { result } = renderHookWithQuery(() => useClasses());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useBuildings", () => {
  it("returns buildings from API", async () => {
    (client.fetchBuildings as jest.Mock).mockResolvedValueOnce({
      buildings: [{ building_id: "b1", name: "Siebel", lat: 40.1, lng: -88.2 }],
    });
    const { useBuildings } = getHooks();
    const { result } = renderHookWithQuery(() => useBuildings());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.buildings[0].name).toBe("Siebel");
  });
});

describe("useBuildingSearch", () => {
  it("does not fetch when query is shorter than 2 chars", () => {
    const { useBuildingSearch } = getHooks();
    const { result } = renderHookWithQuery(() => useBuildingSearch("S"));
    expect(result.current.fetchStatus).toBe("idle");
    expect(client.fetchBuildingSearch).not.toHaveBeenCalled();
  });

  it("fetches when query is 2+ chars", async () => {
    (client.fetchBuildingSearch as jest.Mock).mockResolvedValueOnce({ buildings: [] });
    const { useBuildingSearch } = getHooks();
    const { result } = renderHookWithQuery(() => useBuildingSearch("Si"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.fetchBuildingSearch).toHaveBeenCalledWith("http://test", "Si", { apiKey: null });
  });
});

describe("useCreateClass", () => {
  it("invalidates classes query on success", async () => {
    (client.createClass as jest.Mock).mockResolvedValueOnce({ class_id: "new", title: "New", days_of_week: [], start_time_local: "10:00", building_id: "b1" });
    const { useCreateClass } = getHooks();
    const { result, client: qc } = renderHookWithQuery(() => useCreateClass());
    const spy = jest.spyOn(qc, "invalidateQueries");
    result.current.mutate({ title: "New", days_of_week: [], start_time_local: "10:00" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["classes"] });
  });
});

describe("useDeleteClass", () => {
  it("invalidates classes query on success", async () => {
    (client.deleteClass as jest.Mock).mockResolvedValueOnce(undefined);
    const { useDeleteClass } = getHooks();
    const { result, client: qc } = renderHookWithQuery(() => useDeleteClass());
    const spy = jest.spyOn(qc, "invalidateQueries");
    result.current.mutate("c1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["classes"] });
  });
});
