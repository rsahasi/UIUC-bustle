# TanStack Query Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all manual `useEffect + useState` data-fetching patterns across 4 tab screens with TanStack Query hooks, eliminating loading spinners on repeat tab visits and manual polling boilerplate.

**Architecture:** New `mobile/src/queries/` directory holds domain-specific hooks (schedule, departures, recommendation, map, places) that wrap existing `client.ts` functions. Each hook calls `useApiBaseUrl()` internally to get `baseUrl`/`apiKey`. A `QueryClientProvider` is added to `_layout.tsx`. Screens swap manual fetch sequences for hook calls.

**Tech Stack:** `@tanstack/react-query` v5, `jest-expo`, `@testing-library/react-native`, existing `client.ts` functions (unchanged)

**Spec:** `docs/superpowers/specs/2026-03-17-tanstack-query-design.md`

---

## Chunk 1: Library Layer

### Task 1: Install packages + Jest setup + renderWithQuery utility

**Files:**
- Modify: `mobile/package.json`
- Create: `mobile/src/test-utils/renderWithQuery.tsx`

- [ ] **Step 1: Install @tanstack/react-query**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx expo install @tanstack/react-query
  ```
  Expected: `@tanstack/react-query` added to `package.json` dependencies.

- [ ] **Step 2: Install Jest + testing library**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx expo install jest-expo @testing-library/react-native react-test-renderer --save-dev
  ```

- [ ] **Step 3: Add Jest config to `package.json`**

  In `mobile/package.json`, add a `"jest"` section at the top level (after `"scripts"`):
  ```json
  "jest": {
    "preset": "jest-expo",
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@tanstack/.*)"
    ],
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/$1"
    }
  }
  ```

- [ ] **Step 4: Create `mobile/src/test-utils/renderWithQuery.tsx`**

  ```tsx
  import React from "react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { render, renderHook } from "@testing-library/react-native";

  export function createTestQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  }

  export function renderWithQuery(ui: React.ReactElement) {
    const client = createTestQueryClient();
    return render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    );
  }

  export function renderHookWithQuery<T>(hook: () => T) {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { ...renderHook(hook, { wrapper }), client };
  }
  ```

- [ ] **Step 5: Verify Jest runs (no test files yet is OK)**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest --passWithNoTests 2>&1 | tail -5
  ```
  Expected: exits 0 (no test files found is fine).

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | grep -i "test-utils" | head -10
  ```
  Expected: no errors related to `renderWithQuery.tsx`.

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add package.json src/test-utils/renderWithQuery.tsx && git commit -m "feat: add @tanstack/react-query + Jest testing infrastructure"
  ```

---

### Task 2: schedule.ts query hooks (TDD)

**Files:**
- Create: `mobile/src/queries/__tests__/schedule.test.ts`
- Create: `mobile/src/queries/schedule.ts`

- [ ] **Step 1: Create test directory and write failing tests**

  ```bash
  mkdir -p /Users/25ruhans/UIUC_APP/mobile/src/queries/__tests__
  ```

  Create `mobile/src/queries/__tests__/schedule.test.ts`:
  ```typescript
  import { renderHook, waitFor } from "@testing-library/react-native";
  import { renderHookWithQuery } from "@/src/test-utils/renderWithQuery";
  import * as client from "@/src/api/client";

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

  // Import hooks after mocks are set up
  const getHooks = () => require("../schedule");

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

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
  ```

- [ ] **Step 2: Run tests — verify they all FAIL**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/schedule.test.ts --no-coverage 2>&1 | tail -15
  ```
  Expected: all tests fail with `Cannot find module '../schedule'`

- [ ] **Step 3: Create `mobile/src/queries/schedule.ts`**

  ```typescript
  import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
  import {
    createClass,
    deleteClass,
    fetchBuildingSearch,
    fetchBuildings,
    fetchClasses,
  } from "@/src/api/client";
  import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

  export function useClasses() {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["classes"],
      queryFn: () => fetchClasses(apiBaseUrl, { apiKey }),
      staleTime: 60_000,
      enabled: !!apiBaseUrl,
    });
  }

  export function useBuildings() {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["buildings"],
      queryFn: () => fetchBuildings(apiBaseUrl, { apiKey }),
      staleTime: Infinity,
      enabled: !!apiBaseUrl,
    });
  }

  export function useBuildingSearch(query: string) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["building-search", query],
      queryFn: () => fetchBuildingSearch(apiBaseUrl, query, { apiKey }),
      staleTime: 30_000,
      enabled: !!apiBaseUrl && query.length >= 2,
    });
  }

  export function useCreateClass() {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (body: Parameters<typeof createClass>[1]) =>
        createClass(apiBaseUrl, body, { apiKey }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["classes"] });
      },
    });
  }

  export function useDeleteClass() {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (classId: string) =>
        deleteClass(apiBaseUrl, classId, { apiKey }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["classes"] });
      },
    });
  }
  ```

- [ ] **Step 4: Run tests — verify all pass**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/schedule.test.ts --no-coverage 2>&1 | tail -10
  ```
  Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add src/queries/schedule.ts src/queries/__tests__/schedule.test.ts && git commit -m "feat: add schedule query hooks (useClasses, useBuildings, useBuildingSearch, useCreateClass, useDeleteClass)"
  ```

---

### Task 3: departures.ts query hooks (TDD)

**Files:**
- Create: `mobile/src/queries/__tests__/departures.test.ts`
- Create: `mobile/src/queries/departures.ts`

- [ ] **Step 1: Write failing tests**

  Create `mobile/src/queries/__tests__/departures.test.ts`:
  ```typescript
  import { waitFor } from "@testing-library/react-native";
  import { renderHookWithQuery } from "@/src/test-utils/renderWithQuery";
  import * as client from "@/src/api/client";

  jest.mock("@/src/api/client");
  jest.mock("@/src/hooks/useApiBaseUrl", () => ({
    useApiBaseUrl: () => ({ apiBaseUrl: "http://test", apiKey: null }),
  }));

  const getHooks = () => require("../departures");
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  describe("useDepartures", () => {
    it("returns departures for a stop", async () => {
      (client.fetchDepartures as jest.Mock).mockResolvedValueOnce({
        stop_id: "IT",
        departures: [{ route: "5", headsign: "Lincoln Square", expected_mins: 3, expected_time_iso: null, is_realtime: true }],
      });
      const { useDepartures } = getHooks();
      const { result } = renderHookWithQuery(() => useDepartures("IT"));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.departures).toHaveLength(1);
      expect(client.fetchDepartures).toHaveBeenCalledWith("http://test", "IT", 60, { apiKey: null });
    });

    it("does not fetch when enabled is false", () => {
      const { useDepartures } = getHooks();
      const { result } = renderHookWithQuery(() => useDepartures("IT", { enabled: false }));
      expect(result.current.fetchStatus).toBe("idle");
      expect(client.fetchDepartures).not.toHaveBeenCalled();
    });

    it("does not fetch when stopId is empty", () => {
      const { useDepartures } = getHooks();
      const { result } = renderHookWithQuery(() => useDepartures(""));
      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useNearbyStops", () => {
    it("returns stops for given coordinates", async () => {
      (client.fetchNearbyStops as jest.Mock).mockResolvedValueOnce({
        stops: [{ stop_id: "IT", stop_name: "Illinois Terminal", lat: 40.11, lng: -88.23 }],
      });
      const { useNearbyStops } = getHooks();
      const { result } = renderHookWithQuery(() => useNearbyStops(40.11, -88.23));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.stops).toHaveLength(1);
      expect(client.fetchNearbyStops).toHaveBeenCalledWith("http://test", 40.11, -88.23, 800, { apiKey: null });
    });

    it("does not fetch when lat/lng are 0", () => {
      const { useNearbyStops } = getHooks();
      const { result } = renderHookWithQuery(() => useNearbyStops(0, 0));
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("does not fetch when enabled is false", () => {
      const { useNearbyStops } = getHooks();
      const { result } = renderHookWithQuery(() => useNearbyStops(40.11, -88.23, { enabled: false }));
      expect(result.current.fetchStatus).toBe("idle");
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they FAIL**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/departures.test.ts --no-coverage 2>&1 | tail -5
  ```
  Expected: FAIL with `Cannot find module '../departures'`

- [ ] **Step 3: Create `mobile/src/queries/departures.ts`**

  ```typescript
  import { useQuery } from "@tanstack/react-query";
  import { fetchDepartures, fetchNearbyStops } from "@/src/api/client";
  import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

  export function useDepartures(
    stopId: string,
    options?: { enabled?: boolean }
  ) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["departures", stopId],
      queryFn: () => fetchDepartures(apiBaseUrl, stopId, 60, { apiKey }),
      staleTime: 30_000,
      refetchInterval: 30_000,
      enabled: (options?.enabled ?? true) && !!apiBaseUrl && !!stopId,
    });
  }

  export function useNearbyStops(
    lat: number,
    lng: number,
    options?: { enabled?: boolean }
  ) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["nearby-stops", lat, lng],
      queryFn: () => fetchNearbyStops(apiBaseUrl, lat, lng, 800, { apiKey }),
      staleTime: 60_000,
      enabled:
        (options?.enabled ?? true) &&
        !!apiBaseUrl &&
        lat !== 0 &&
        lng !== 0,
    });
  }
  ```

- [ ] **Step 4: Run tests — verify all 6 pass**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/departures.test.ts --no-coverage 2>&1 | tail -5
  ```
  Expected: 6 passed.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add src/queries/departures.ts src/queries/__tests__/departures.test.ts && git commit -m "feat: add departures query hooks (useDepartures, useNearbyStops)"
  ```

---

### Task 4: recommendation.ts query hook (TDD)

**Files:**
- Create: `mobile/src/queries/__tests__/recommendation.test.ts`
- Create: `mobile/src/queries/recommendation.ts`

- [ ] **Step 1: Write failing tests**

  Create `mobile/src/queries/__tests__/recommendation.test.ts`:
  ```typescript
  import { waitFor } from "@testing-library/react-native";
  import { renderHookWithQuery } from "@/src/test-utils/renderWithQuery";
  import * as client from "@/src/api/client";
  import type { RecommendationRequest } from "@/src/api/types";

  jest.mock("@/src/api/client");
  jest.mock("@/src/hooks/useApiBaseUrl", () => ({
    useApiBaseUrl: () => ({ apiBaseUrl: "http://test", apiKey: null }),
  }));

  const getHooks = () => require("../recommendation");
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

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
      const { useRecommendation } = getHooks();
      const { result } = renderHookWithQuery(() => useRecommendation(PARAMS));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.options).toHaveLength(1);
      expect(client.fetchRecommendation).toHaveBeenCalledWith("http://test", PARAMS, { apiKey: null });
    });

    it("does not fetch when params are null", () => {
      const { useRecommendation } = getHooks();
      const { result } = renderHookWithQuery(() => useRecommendation(null));
      expect(result.current.fetchStatus).toBe("idle");
      expect(client.fetchRecommendation).not.toHaveBeenCalled();
    });

    it("does not fetch when enabled is false", () => {
      const { useRecommendation } = getHooks();
      const { result } = renderHookWithQuery(() =>
        useRecommendation(PARAMS, { enabled: false })
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("re-fetches when params change", async () => {
      (client.fetchRecommendation as jest.Mock).mockResolvedValue({ options: [] });
      const { useRecommendation } = getHooks();
      const { result, rerender } = renderHookWithQuery(() =>
        useRecommendation(PARAMS)
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const params2 = { ...PARAMS, walking_speed_mps: 1.9 };
      rerender(() => useRecommendation(params2));
      await waitFor(() => expect(client.fetchRecommendation).toHaveBeenCalledTimes(2));
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they FAIL**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/recommendation.test.ts --no-coverage 2>&1 | tail -5
  ```
  Expected: FAIL with `Cannot find module '../recommendation'`

- [ ] **Step 3: Create `mobile/src/queries/recommendation.ts`**

  ```typescript
  import { useQuery } from "@tanstack/react-query";
  import { fetchRecommendation } from "@/src/api/client";
  import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
  import type { RecommendationRequest } from "@/src/api/types";

  export function useRecommendation(
    params: RecommendationRequest | null,
    options?: { enabled?: boolean }
  ) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      // Spread params object into key so any param change busts the cache.
      // TQ v5 deep-serializes objects in query keys.
      queryKey: params ? ["recommendation", params] : ["recommendation"],
      queryFn: () => fetchRecommendation(apiBaseUrl, params!, { apiKey }),
      staleTime: 30_000,
      refetchInterval: 30_000,
      enabled:
        (options?.enabled ?? true) && !!apiBaseUrl && params !== null,
    });
  }
  ```

- [ ] **Step 4: Run tests — verify all 4 pass**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/recommendation.test.ts --no-coverage 2>&1 | tail -5
  ```
  Expected: 4 passed.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add src/queries/recommendation.ts src/queries/__tests__/recommendation.test.ts && git commit -m "feat: add recommendation query hook"
  ```

---

### Task 5: map.ts query hooks (TDD)

**Files:**
- Create: `mobile/src/queries/__tests__/map.test.ts`
- Create: `mobile/src/queries/map.ts`

- [ ] **Step 1: Write failing tests**

  Create `mobile/src/queries/__tests__/map.test.ts`:
  ```typescript
  import { waitFor } from "@testing-library/react-native";
  import { renderHookWithQuery } from "@/src/test-utils/renderWithQuery";
  import * as client from "@/src/api/client";

  jest.mock("@/src/api/client");
  jest.mock("@/src/hooks/useApiBaseUrl", () => ({
    useApiBaseUrl: () => ({ apiBaseUrl: "http://test", apiKey: null }),
  }));

  const getHooks = () => require("../map");
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  describe("useVehicles", () => {
    it("returns vehicles", async () => {
      (client.fetchVehicles as jest.Mock).mockResolvedValueOnce({
        vehicles: [{ vehicle_id: "v1", lat: 40.1, lng: -88.2, heading: 90, route_id: "5", headsign: "Lincoln" }],
      });
      const { useVehicles } = getHooks();
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
      const { useWalkingRoute } = getHooks();
      const { result } = renderHookWithQuery(() =>
        useWalkingRoute(40.1, -88.2, 40.11, -88.21)
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.coords).toHaveLength(2);
    });

    it("does not fetch when coords are zero", () => {
      const { useWalkingRoute } = getHooks();
      const { result } = renderHookWithQuery(() => useWalkingRoute(0, 0, 40.11, -88.21));
      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useBusRouteStops", () => {
    it("returns stops and shape", async () => {
      (client.fetchBusRouteStops as jest.Mock).mockResolvedValueOnce({
        trip_id: "t1", stops: [], shape_points: [],
      });
      const { useBusRouteStops } = getHooks();
      const { result } = renderHookWithQuery(() =>
        useBusRouteStops("5", "IT", "MAIN", "2026-03-17T09:00:00")
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it("does not fetch when routeId is empty", () => {
      const { useBusRouteStops } = getHooks();
      const { result } = renderHookWithQuery(() =>
        useBusRouteStops("", "IT", "MAIN", "2026-03-17T09:00:00")
      );
      expect(result.current.fetchStatus).toBe("idle");
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they FAIL**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/map.test.ts --no-coverage 2>&1 | tail -5
  ```
  Expected: FAIL with `Cannot find module '../map'`

- [ ] **Step 3: Create `mobile/src/queries/map.ts`**

  ```typescript
  import { useQuery } from "@tanstack/react-query";
  import { fetchBusRouteStops, fetchVehicles, fetchWalkingRoute } from "@/src/api/client";
  import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

  export function useVehicles(options?: { enabled?: boolean }) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["vehicles"],
      queryFn: () => fetchVehicles(apiBaseUrl, undefined, { apiKey }),
      staleTime: 10_000,
      refetchInterval: 15_000,
      enabled: (options?.enabled ?? true) && !!apiBaseUrl,
    });
  }

  export function useWalkingRoute(
    origLat: number,
    origLng: number,
    destLat: number,
    destLng: number,
    options?: { enabled?: boolean }
  ) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["walking-route", origLat, origLng, destLat, destLng],
      queryFn: () =>
        fetchWalkingRoute(apiBaseUrl, origLat, origLng, destLat, destLng, { apiKey }),
      staleTime: 300_000,
      enabled:
        (options?.enabled ?? true) &&
        !!apiBaseUrl &&
        origLat !== 0 &&
        origLng !== 0 &&
        destLat !== 0 &&
        destLng !== 0,
    });
  }

  export function useBusRouteStops(
    routeId: string,
    fromStopId: string,
    toStopId: string,
    afterTime: string,
    options?: { enabled?: boolean }
  ) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["bus-route-stops", routeId, fromStopId, toStopId, afterTime],
      queryFn: () =>
        fetchBusRouteStops(apiBaseUrl, routeId, fromStopId, toStopId, afterTime, { apiKey }),
      staleTime: 300_000,
      enabled:
        (options?.enabled ?? true) &&
        !!apiBaseUrl &&
        !!routeId &&
        !!fromStopId &&
        !!toStopId,
    });
  }
  ```

- [ ] **Step 4: Run tests — verify all 5 pass**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/map.test.ts --no-coverage 2>&1 | tail -5
  ```
  Expected: 5 passed.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add src/queries/map.ts src/queries/__tests__/map.test.ts && git commit -m "feat: add map query hooks (useVehicles, useWalkingRoute, useBusRouteStops)"
  ```

---

### Task 6: places.ts query hooks (TDD)

**Files:**
- Create: `mobile/src/queries/__tests__/places.test.ts`
- Create: `mobile/src/queries/places.ts`

- [ ] **Step 1: Write failing tests**

  Create `mobile/src/queries/__tests__/places.test.ts`:
  ```typescript
  import { waitFor } from "@testing-library/react-native";
  import { renderHookWithQuery } from "@/src/test-utils/renderWithQuery";
  import * as client from "@/src/api/client";

  jest.mock("@/src/api/client");
  jest.mock("@/src/hooks/useApiBaseUrl", () => ({
    useApiBaseUrl: () => ({ apiBaseUrl: "http://test", apiKey: null }),
  }));

  const getHooks = () => require("../places");
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  describe("useAutocomplete", () => {
    it("returns results for 2+ char query", async () => {
      (client.fetchAutocomplete as jest.Mock).mockResolvedValueOnce({
        results: [{ type: "building", name: "Siebel", lat: 40.1, lng: -88.2 }],
      });
      const { useAutocomplete } = getHooks();
      const { result } = renderHookWithQuery(() => useAutocomplete("Si"));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.results).toHaveLength(1);
    });

    it("does not fetch for 1-char query", () => {
      const { useAutocomplete } = getHooks();
      const { result } = renderHookWithQuery(() => useAutocomplete("S"));
      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("usePlacesAutocomplete", () => {
    it("returns predictions for 2+ char query", async () => {
      (client.fetchPlacesAutocomplete as jest.Mock).mockResolvedValueOnce({
        predictions: [{ place_id: "p1", main_text: "Siebel", secondary_text: "Urbana", description: "Siebel, Urbana" }],
      });
      const { usePlacesAutocomplete } = getHooks();
      const { result } = renderHookWithQuery(() => usePlacesAutocomplete("Si"));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.predictions).toHaveLength(1);
    });

    it("does not fetch for 1-char query", () => {
      const { usePlacesAutocomplete } = getHooks();
      const { result } = renderHookWithQuery(() => usePlacesAutocomplete("S"));
      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("usePlaceDetails", () => {
    it("fetches details for a valid placeId", async () => {
      (client.fetchPlaceDetails as jest.Mock).mockResolvedValueOnce({
        lat: 40.1, lng: -88.2, display_name: "Siebel Center",
      });
      const { usePlaceDetails } = getHooks();
      const { result } = renderHookWithQuery(() => usePlaceDetails("p1"));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.display_name).toBe("Siebel Center");
    });

    it("does not fetch when placeId is null", () => {
      const { usePlaceDetails } = getHooks();
      const { result } = renderHookWithQuery(() => usePlaceDetails(null));
      expect(result.current.fetchStatus).toBe("idle");
    });
  });

  describe("useGeocode", () => {
    it("returns geocode result", async () => {
      (client.fetchGeocode as jest.Mock).mockResolvedValueOnce({
        lat: 40.11, lng: -88.23, display_name: "UIUC Campus",
      });
      const { useGeocode } = getHooks();
      const { result } = renderHookWithQuery(() => useGeocode("UIUC"));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.display_name).toBe("UIUC Campus");
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they FAIL**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/__tests__/places.test.ts --no-coverage 2>&1 | tail -5
  ```
  Expected: FAIL with `Cannot find module '../places'`

- [ ] **Step 3: Create `mobile/src/queries/places.ts`**

  ```typescript
  import { useQuery } from "@tanstack/react-query";
  import {
    fetchAutocomplete,
    fetchGeocode,
    fetchPlaceDetails,
    fetchPlacesAutocomplete,
  } from "@/src/api/client";
  import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

  export function useAutocomplete(query: string) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["autocomplete", query],
      queryFn: () => fetchAutocomplete(apiBaseUrl, query, { apiKey }),
      staleTime: 10_000,
      enabled: !!apiBaseUrl && query.length >= 2,
    });
  }

  export function usePlacesAutocomplete(query: string, sessionToken?: string) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["places-autocomplete", query],
      queryFn: () =>
        fetchPlacesAutocomplete(apiBaseUrl, query, sessionToken, { apiKey }),
      staleTime: 10_000,
      enabled: !!apiBaseUrl && query.length >= 2,
    });
  }

  export function usePlaceDetails(placeId: string | null) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["place-details", placeId],
      queryFn: () => fetchPlaceDetails(apiBaseUrl, placeId!, { apiKey }),
      staleTime: Infinity,
      enabled: !!apiBaseUrl && !!placeId,
    });
  }

  export function useGeocode(query: string | null) {
    const { apiBaseUrl, apiKey } = useApiBaseUrl();
    return useQuery({
      queryKey: ["geocode", query],
      queryFn: () => fetchGeocode(apiBaseUrl, query!, { apiKey }),
      staleTime: 86_400_000,
      enabled: !!apiBaseUrl && !!query,
    });
  }
  ```

- [ ] **Step 4: Run all tests — verify all pass**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/ --no-coverage 2>&1 | tail -10
  ```
  Expected: all tests pass across all 5 test files.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add src/queries/places.ts src/queries/__tests__/places.test.ts && git commit -m "feat: add places query hooks (useAutocomplete, usePlacesAutocomplete, usePlaceDetails, useGeocode)"
  ```

---

## Chunk 2: Screen Migrations

### Task 7: `_layout.tsx` — add QueryClientProvider

**Files:**
- Modify: `mobile/app/_layout.tsx:1-30` (imports + QueryClient creation)

- [ ] **Step 1: Add import**

  In `mobile/app/_layout.tsx`, find the line:
  ```typescript
  import { Redirect, Stack, useSegments } from "expo-router";
  ```
  Add a new line immediately after it:
  ```typescript
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  ```

- [ ] **Step 2: Create queryClient constant**

  Find the line `SplashScreen.preventAutoHideAsync();` (near line 65). Add these lines immediately BEFORE it:
  ```typescript
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 300_000,
        retry: 1,
      },
    },
  });

  ```
  The `queryClient` must be created OUTSIDE any component (module level) to avoid recreation on re-render.

- [ ] **Step 3: Wrap return with QueryClientProvider**

  In the `RootLayout` function's return statement, find:
  ```tsx
  return (
    <PostHogProvider
  ```
  Replace with:
  ```tsx
  return (
    <QueryClientProvider client={queryClient}>
      <PostHogProvider
  ```
  And find the closing `</PostHogProvider>` at the bottom of the return:
  ```tsx
    </PostHogProvider>
  );
  ```
  Replace with:
  ```tsx
      </PostHogProvider>
    </QueryClientProvider>
  );
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | grep "_layout" | head -10
  ```
  Expected: no errors in `_layout.tsx`.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add app/_layout.tsx && git commit -m "feat: wrap app in QueryClientProvider"
  ```

---

### Task 8: `schedule.tsx` — replace manual fetches with query hooks

**Files:**
- Modify: `mobile/app/(tabs)/schedule.tsx`

Read `mobile/app/(tabs)/schedule.tsx` in full before making changes.

The current `schedule.tsx` pattern:
- `const [classes, setClasses] = useState([])`
- `const [buildings, setBuildings] = useState([])`
- `const [loading, setLoading] = useState(true)`
- `const [refreshing, setRefreshing] = useState(false)`
- A `loadData()` async function that calls `fetchClasses` + `fetchBuildings` in parallel
- A `useEffect(() => { loadData() }, [apiBaseUrl, apiKey])` that triggers the load
- Building search: a debounced `useEffect` on search query calling `fetchBuildingSearch`
- Places search: a debounced `useEffect` on search query calling `fetchPlacesAutocomplete`
- `deleteClass(...)` call followed by `loadData()` to refresh
- `createClass(...)` call followed by `loadData()` to refresh

- [ ] **Step 1: Add query hook imports**

  At the top of `schedule.tsx`, find where `fetchClasses`, `fetchBuildings`, `fetchBuildingSearch`, `fetchPlacesAutocomplete`, `deleteClass`, `createClass` are imported from `@/src/api/client`. Add new imports after the existing import block:
  ```typescript
  import { useClasses, useBuildings, useBuildingSearch, useCreateClass, useDeleteClass } from "@/src/queries/schedule";
  import { usePlacesAutocomplete } from "@/src/queries/places";
  ```

- [ ] **Step 2: Replace classes + buildings state and loadData**

  Remove:
  - `const [classes, setClasses] = useState([])` (or similar)
  - `const [buildings, setBuildings] = useState([])`
  - `const [loading, setLoading] = useState(true)`
  - `const [refreshing, setRefreshing] = useState(false)`
  - The `loadData()` function entirely
  - The `useEffect` that calls `loadData()`
  - Any references to `fetchClasses`, `fetchBuildings` calls

  Add after the `useApiBaseUrl()` call:
  ```typescript
  const { data: classesData, isLoading, refetch: refetchClasses } = useClasses();
  const { data: buildingsData } = useBuildings();
  const classes = classesData?.classes ?? [];
  const buildings = buildingsData?.buildings ?? [];
  const refreshing = false; // TQ handles background refresh; keep for RefreshControl compat
  ```

  Update `RefreshControl` onRefresh handler to call `refetchClasses()` instead of `loadData()`.

- [ ] **Step 3: Replace delete and create callbacks**

  Find the `deleteClass(...)` call (inside a confirmation handler). Replace the `deleteClass` import call + subsequent `loadData()` with the mutation:

  Add after the hook declarations:
  ```typescript
  const { mutate: deleteClassMutation } = useDeleteClass();
  const { mutate: createClassMutation } = useCreateClass();
  ```

  In the delete handler, replace:
  ```typescript
  await deleteClass(apiBaseUrl, classId, { apiKey });
  await loadData();
  ```
  With:
  ```typescript
  deleteClassMutation(classId);
  ```

  In the create handler, replace:
  ```typescript
  const newClass = await createClass(apiBaseUrl, body, { apiKey });
  await loadData();
  ```
  With:
  ```typescript
  createClassMutation(body, { onSuccess: () => { /* reset form */ } });
  ```

- [ ] **Step 4: Replace debounced building search effect**

  Find the debounced `useEffect` that calls `fetchBuildingSearch`. Remove it and the associated `useState` for building search results. Add:
  ```typescript
  const { data: buildingSearchData } = useBuildingSearch(debouncedBuildingQuery);
  const buildingSearchResults = buildingSearchData?.buildings ?? [];
  ```
  Where `debouncedBuildingQuery` is the existing debounced search query state. Keep the `useState` + `useEffect` for the debounce timer itself (just remove the fetch inside it — the debounce timer now just updates `debouncedBuildingQuery` state).

- [ ] **Step 5: Replace debounced places autocomplete effect**

  Find the debounced `useEffect` that calls `fetchPlacesAutocomplete`. Remove it and its associated `useState`. Add:
  ```typescript
  const { data: placesData } = usePlacesAutocomplete(debouncedPlacesQuery);
  const placesPredictions = placesData?.predictions ?? [];
  ```

- [ ] **Step 6: Remove unused imports**

  Remove from the client import: `fetchClasses`, `fetchBuildings`, `fetchBuildingSearch`, `fetchPlacesAutocomplete`, `deleteClass`, `createClass` (they're now used only through the query hooks).
  Keep `useApiBaseUrl` unconditionally — `apiBaseUrl` and `apiKey` are still needed for the `fetchPlaceDetails` callback in the place-tap handler (one-shot async call, not a TQ query).

- [ ] **Step 7: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | grep "schedule" | head -20
  ```
  Expected: no errors in `schedule.tsx`.

- [ ] **Step 8: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add app/(tabs)/schedule.tsx && git commit -m "feat: migrate schedule.tsx to TanStack Query hooks"
  ```

---

### Task 9: `activity.tsx` — replace EOD report fetch with useMutation

**Files:**
- Modify: `mobile/app/(tabs)/activity.tsx`

Read `mobile/app/(tabs)/activity.tsx` before making changes.

The only network call in activity.tsx is `fetchEodReport` (triggered by a button). Everything else is AsyncStorage reads.

- [ ] **Step 1: Add import**

  Add to the imports in `activity.tsx`:
  ```typescript
  import { useMutation } from "@tanstack/react-query";
  import { fetchEodReport } from "@/src/api/client";
  import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
  ```
  (If `useApiBaseUrl` is already imported, skip that line.)

- [ ] **Step 2: Replace the fetchEodReport manual state**

  Find in the component:
  - `const [reportLoading, setReportLoading] = useState(false)`
  - `const [reportText, setReportText] = useState<string | null>(null)`
  - The `try/catch` block that calls `fetchEodReport(...)`

  Remove those three items. Add:
  ```typescript
  const { apiBaseUrl, apiKey } = useApiBaseUrl(); // add if not present
  const {
    mutate: generateReport,
    isPending: reportLoading,
    data: reportData,
  } = useMutation({
    mutationFn: (payload: Parameters<typeof fetchEodReport>[1]) =>
      fetchEodReport(apiBaseUrl, payload, { apiKey }),
  });
  const reportText = reportData?.report ?? null;
  ```

- [ ] **Step 3: Update the button handler**

  Find the button press handler that previously had `setReportLoading(true); try { const result = await fetchEodReport(...); setReportText(result.report) } finally { setReportLoading(false) }`.

  Replace with:
  ```typescript
  generateReport(payload);
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | grep "activity" | head -10
  ```
  Expected: no errors in `activity.tsx`.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add app/(tabs)/activity.tsx && git commit -m "feat: migrate activity.tsx EOD report to useMutation"
  ```

---

### Task 10: `map.tsx` — replace vehicles polling and departure fetch

**Files:**
- Modify: `mobile/app/(tabs)/map.tsx`

Read `mobile/app/(tabs)/map.tsx` before making changes. Key patterns to find and replace:

**Vehicles polling pattern (find by `liveIntervalRef` or `fetchVehicles` + `setInterval`):**
- Currently: `const [vehicles, setVehicles] = useState([])` + `useEffect` with `setInterval(() => fetchVehicles(...), 15000)` + `clearInterval` on cleanup

**Departures pattern (find by `fetchDepartures` in a stop-tap handler):**
- Currently: `const [departures, setDepartures] = useState([])` + `setLoading` + `await fetchDepartures(...)`

**Nearby stops pattern:**
- Currently: `fetchNearbyStops(...)` inside a location useEffect

- [ ] **Step 1: Add query hook imports**

  Add to imports in `map.tsx`:
  ```typescript
  import { useVehicles } from "@/src/queries/map";
  import { useDepartures } from "@/src/queries/departures";
  import { useNearbyStops } from "@/src/queries/departures";
  ```

- [ ] **Step 2: Replace vehicles polling**

  Remove:
  - `const [vehicles, setVehicles] = useState<VehicleInfo[]>([])`
  - The `useEffect` that sets up a `setInterval` for `fetchVehicles`
  - Any `clearInterval` cleanup for vehicles
  - `vehiclesRef` or similar refs used only for polling

  Add near the top of the component:
  ```typescript
  const { data: vehiclesData } = useVehicles();
  const vehicles = vehiclesData?.vehicles ?? [];
  ```

- [ ] **Step 3: Replace nearby stops fetch**

  Find the `useEffect` that calls `fetchNearbyStops(lat, lng, ...)` when location becomes available. Remove it and the associated `useState` for stops. Add:
  ```typescript
  const { data: nearbyStopsData } = useNearbyStops(
    location?.lat ?? 0,
    location?.lng ?? 0,
    { enabled: !!location }
  );
  const stops = nearbyStopsData?.stops ?? [];
  ```
  Where `location` is the existing location state in map.tsx.

- [ ] **Step 4: Replace departures fetch in stop-tap handler**

  Find the function/handler that fires when a stop marker is tapped and calls `fetchDepartures`. This is likely an `async` callback.

  Remove:
  - `const [stopDepartures, setStopDepartures] = useState<DepartureItem[]>([])`
  - The `setLoading`/`fetchDepartures`/`setStopDepartures` sequence

  Add near the top of the component:
  ```typescript
  const { data: departuresData, isLoading: departuresLoading } = useDepartures(
    selectedStop?.stop_id ?? "",
    { enabled: !!selectedStop }
  );
  const stopDepartures = departuresData?.departures ?? [];
  ```
  Where `selectedStop` is the existing state for the currently tapped stop.

- [ ] **Step 5: Replace polyline fetches with useQueries**

  Find where `fetchWalkingRoute` and `fetchBusRouteStops` are called (inside effects or handlers when a route is selected). Replace with `useWalkingRoute` and `useBusRouteStops`.

  For the walk polyline (one per selected WALK route option):
  ```typescript
  import { useWalkingRoute, useBusRouteStops } from "@/src/queries/map";

  // selectedWalkStep is derived from selectedRoute's steps (first WALK_TO_STOP or WALK_TO_DEST step)
  const { data: walkRouteData } = useWalkingRoute(
    walkStep?.origLat ?? 0,
    walkStep?.origLng ?? 0,
    walkStep?.destLat ?? 0,
    walkStep?.destLng ?? 0,
    { enabled: !!walkStep }
  );
  ```

  For the bus polyline (RIDE steps — may be multiple per route):
  ```typescript
  // If there are multiple steps, use useQueries instead:
  import { useQueries } from "@tanstack/react-query";
  import { fetchBusRouteStops } from "@/src/api/client";
  const { apiBaseUrl, apiKey } = useApiBaseUrl();

  const busRouteQueries = useQueries({
    queries: rideSteps.map(step => ({
      queryKey: ["bus-route-stops", step.routeId, step.fromStopId, step.toStopId],
      queryFn: () => fetchBusRouteStops(apiBaseUrl, step.routeId, step.fromStopId, step.toStopId, step.afterTime, { apiKey }),
      staleTime: 300_000,
      enabled: !!apiBaseUrl && !!step.routeId,
    })),
  });
  ```
  Adapt variable names (`rideSteps`, `step.routeId`, etc.) to match what map.tsx actually calls these values.

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | grep "map.tsx" | head -20
  ```
  Expected: no errors in `map.tsx`.

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add app/(tabs)/map.tsx && git commit -m "feat: migrate map.tsx to TanStack Query hooks (vehicles, stops, departures, polylines)"
  ```

---

### Task 11: `useLeaveBy.ts` — replace internal fetch + interval with shared query hooks

**Files:**
- Modify: `mobile/src/hooks/useLeaveBy.ts`

This task replaces the entire hook body while keeping all business logic (`mapOptionToLeaveByOption`, the lookahead window check, weather multiplier) intact. Only the data fetching and polling parts are replaced.

- [ ] **Step 1: Read the current file**

  Read `mobile/src/hooks/useLeaveBy.ts` in full. Identify:
  - The `useEffect` that calls `fetchClasses` (around line 155)
  - The `useEffect` that sets up `setInterval(refresh, REFRESH_INTERVAL_MS)` (around line 285)
  - The `REFRESH_INTERVAL_MS` constant
  - The `fetchClasses` and `fetchRecommendation` import

- [ ] **Step 2: Update imports**

  In `useLeaveBy.ts`:

  Remove from the import lines:
  ```typescript
  import { fetchClasses, fetchRecommendation } from "@/src/api/client";
  import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
  ```

  Add:
  ```typescript
  import { useMemo } from "react";  // add to existing react import
  import { useClasses } from "@/src/queries/schedule";
  import { useRecommendation } from "@/src/queries/recommendation";
  import type { RecommendationRequest } from "@/src/api/types";
  ```

  Also remove: `import type { ScheduleClass } from "@/src/api/types"` if it's no longer needed (it may still be needed for `getNextClassToday`'s return type — keep if so).

- [ ] **Step 3: Replace the `useLeaveBy` function body**

  Replace the entire `useLeaveBy` function (from `export function useLeaveBy()` to its closing `}`) with this new implementation. **All helper functions outside `useLeaveBy` (`minutesSinceMidnight`, `epochMsFromDepartInMinutes`, `formatHHMM`, `sumStepDuration`, `mapOptionToLeaveByOption`, constants `UIUC_FALLBACK`, `LOOKAHEAD_HOURS`) remain unchanged.**

  ```typescript
  export function useLeaveBy(): LeaveByState {
    const { walkingSpeedMps, bufferMinutes, rainMode } = useRecommendationSettings();

    const locationRef = useRef<{ lat: number; lng: number }>(UIUC_FALLBACK);
    const [weather, setWeather] = useState<WeatherData | null>(null);

    // Load location and weather on mount (unchanged from original)
    useEffect(() => {
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status === "granted") {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            locationRef.current = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            };
          }
        } catch {
          // fall through to UIUC_FALLBACK
        }
        const { lat, lng } = locationRef.current;
        const w = await getWeatherForLocation(lat, lng);
        setWeather(w);
      })();
    }, []);

    // Classes from shared TQ cache — no more fetchClasses or setInterval needed
    const { data: classesData, isLoading: classesLoading } = useClasses();
    const allClasses = classesData?.classes ?? [];

    // Compute next class and recommendation params in render
    const recParams = useMemo<RecommendationRequest | null>(() => {
      const now = new Date();
      const nowMins = minutesSinceMidnight(now);
      const nextClass = getNextClassToday(allClasses, now);

      if (!nextClass) return null;

      const [ch, cm] = nextClass.start_time_local.split(":").map(Number);
      const classStartMins = (ch ?? 0) * 60 + (cm ?? 0);
      const minsUntilClass = classStartMins - nowMins;

      if (minsUntilClass > LOOKAHEAD_HOURS * 60 || minsUntilClass < 0) return null;

      const hasCustomDest =
        nextClass.destination_lat != null && nextClass.destination_lng != null;
      const weatherMult = weather ? getWalkMultiplier(weather) : 1.0;
      const effectiveWalkingSpeedMps = walkingSpeedMps / weatherMult;
      const weatherCondition = weather?.condition;
      const autoRainMode =
        weatherCondition === "RAIN" ||
        weatherCondition === "HEAVY_RAIN" ||
        weatherCondition === "STORM";

      return {
        lat: locationRef.current.lat,
        lng: locationRef.current.lng,
        ...(hasCustomDest
          ? {
              destination_lat: nextClass.destination_lat!,
              destination_lng: nextClass.destination_lng!,
              destination_name: nextClass.destination_name ?? undefined,
            }
          : { destination_building_id: nextClass.building_id }),
        arrive_by_iso: arriveByIsoToday(nextClass.start_time_local),
        walking_speed_mps: effectiveWalkingSpeedMps,
        buffer_minutes: bufferMinutes,
        max_options: 4,
        prefer_bus: rainMode || autoRainMode,
      };
    }, [allClasses, walkingSpeedMps, bufferMinutes, rainMode, weather]);

    // Recommendation from shared TQ cache — refetchInterval: 30_000 replaces setInterval
    const { data: recData, isLoading: recLoading } = useRecommendation(recParams);

    // Derive LeaveByState from TQ query results
    return useMemo<LeaveByState>(() => {
      const now = new Date();
      const nextClass = getNextClassToday(allClasses, now);

      if (classesLoading) {
        return {
          nextClass: null,
          options: [],
          walkOnlyMins: null,
          isLoading: true,
          lastUpdated: null,
          noViableBus: false,
          weather,
        };
      }

      if (!nextClass || !recParams) {
        return {
          nextClass: nextClass ?? null,
          options: [],
          walkOnlyMins: null,
          isLoading: false,
          lastUpdated: now,
          noViableBus: false,
          weather,
        };
      }

      if (recLoading) {
        return {
          nextClass,
          options: [],
          walkOnlyMins: null,
          isLoading: true,
          lastUpdated: null,
          noViableBus: false,
          weather,
        };
      }

      const [ch, cm] = nextClass.start_time_local.split(":").map(Number);
      const classStartMins = (ch ?? 0) * 60 + (cm ?? 0);
      const rawOptions = recData?.options ?? [];

      const walkOption = rawOptions.find((o) => o.type === "WALK");
      const busOptions = rawOptions.filter((o) => o.type !== "WALK");

      const mappedBusOptions: LeaveByOption[] = busOptions
        .map((opt) => mapOptionToLeaveByOption(opt, classStartMins, now))
        .sort((a, b) => b.marginMins - a.marginMins);

      const walkOnlyMins =
        walkOption && walkOption.eta_minutes < 30 ? walkOption.eta_minutes : null;

      const noViableBus =
        mappedBusOptions.length > 0 &&
        mappedBusOptions.every((o) => o.status === "late") &&
        walkOnlyMins == null;

      return {
        nextClass,
        options: mappedBusOptions,
        walkOnlyMins,
        isLoading: false,
        lastUpdated: now,
        noViableBus,
        weather,
      };
    }, [classesLoading, allClasses, recParams, recLoading, recData, weather]);
  }
  ```

  Also remove: `const REFRESH_INTERVAL_MS = 30_000;` (no longer needed).

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | grep "useLeaveBy" | head -10
  ```
  Expected: no errors in `useLeaveBy.ts`.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add src/hooks/useLeaveBy.ts && git commit -m "feat: migrate useLeaveBy to shared TQ query hooks — remove internal fetch + interval"
  ```

---

### Task 12: `index.tsx` — replace manual fetch sequences with query hooks

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

This is the most complex migration. Read `mobile/app/(tabs)/index.tsx` in full before starting.

The Home screen currently has:
- `scheduleClasses`: replaced by `useClasses()`
- `stops` + `departuresByStop`: replaced by `useNearbyStops()` + `useQueries` for departures
- `recommendations`: replaced by `useRecommendation()`
- `autocompleteSuggestions`: replaced by `useAutocomplete(searchQuery)`
- A `liveIntervalRef` for 30s refresh: removed (TQ `refetchInterval` handles it)
- An `AbortController` (`abortRef`): removed (TQ handles abort on unmount)

- [ ] **Step 1: Add query hook imports**

  At the top of `index.tsx`, add after the existing imports:
  ```typescript
  import { useQueries } from "@tanstack/react-query";
  import { useClasses } from "@/src/queries/schedule";
  import { useNearbyStops, useDepartures } from "@/src/queries/departures";
  import { useRecommendation } from "@/src/queries/recommendation";
  import { useAutocomplete } from "@/src/queries/places";
  ```

- [ ] **Step 2: Remove manual data state declarations**

  Find and remove these `useState` declarations:
  - `const [scheduleClasses, setScheduleClasses] = useState<...>([]);`
  - `const [stops, setStops] = useState<StopWithDistance[]>([]);`
  - `const [departuresByStop, setDeparturesByStop] = useState<Record<string, DepartureItem[]>>({});`
  - `const [recommendations, setRecommendations] = useState<RecommendationOption[]>([]);`
  - `const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<AutocompleteResult[]>([]);`

  Keep all other `useState` declarations (UI state: `refreshing`, `highlightWalk`, `offlineBanner`, `searchQuery`, `searchLoading`, `searchError`, `searchResults`, `recentSearches`, etc.).

- [ ] **Step 3: Remove refs used only for polling**

  Remove:
  - `const liveIntervalRef = useRef<...>(null);` (used for the 30s interval)
  - `const stopsRef = useRef<StopWithDistance[]>([]);` (if used only for live refresh)
  - `const classesRef = useRef<typeof scheduleClasses>([]);` (used only for passing to refresh)
  - `const abortRef = useRef<AbortController | null>(null);`

  Keep: `locationRef`, `scrollRef`, `recommendationsY`, `sessionTokenRef`, `lastNotifScheduleRef`, `refreshTimeoutRef`.

- [ ] **Step 4: Load `lastKnownHomeData` for cold-start placeholderData**

  Find the existing `useEffect` that reads `lastKnownHomeData` from AsyncStorage (there should already be one in index.tsx — it was added as part of the offline cache feature). Convert it to a `useState` that is populated on mount:

  ```typescript
  const [cachedHomeData, setCachedHomeData] = useState<LastKnownHomeData | null>(null);

  useEffect(() => {
    getLastKnownHomeData().then(data => setCachedHomeData(data));
  }, []);
  ```

  This value is used as `placeholderData` on the nearby-stops query and departure queries (in Step 5 below). `placeholderData` shows the cached snapshot while TQ fetches fresh data — it does NOT count toward `staleTime`, so the query always refetches on mount. This prevents a blank screen flash on cold start.

- [ ] **Step 5: Add query hook calls**

  Add these after the existing hook calls (`useApiBaseUrl`, `useLeaveBy`, etc.) at the top of `HomeScreen`:

  Note: `location` in index.tsx has shape `{ lat: number; lng: number } | null` (NOT an Expo LocationObject — do not use `.coords.latitude`).

  ```typescript
  // Classes — shared cache with useLeaveBy (no duplicate requests)
  const { data: classesData } = useClasses();
  const scheduleClasses = classesData?.classes ?? [];

  // Nearby stops — depends on location state
  // placeholderData: cached snapshot shows on cold start while TQ fetches fresh data.
  // Does NOT count toward staleTime — TQ always refetches on mount regardless.
  const { data: nearbyStopsData } = useNearbyStops(
    location?.lat ?? 0,
    location?.lng ?? 0,
    {
      enabled: !!location && location.lat !== 0,
      // cachedHomeData.stops matches NearbyStopsResponse { stops: StopInfo[] }
      placeholderData: cachedHomeData ? { stops: cachedHomeData.stops } : undefined,
    }
  );
  const stops = (nearbyStopsData?.stops ?? []).slice(0, TOP_STOPS) as StopWithDistance[];

  // Departures — one query per stop, all in parallel
  const departureQueries = useQueries({
    queries: stops.map((stop) => ({
      queryKey: ["departures", stop.stop_id],
      queryFn: () => fetchDepartures(apiBaseUrl, stop.stop_id, 60, { apiKey }),
      staleTime: 30_000,
      refetchInterval: 30_000,
      enabled: !!apiBaseUrl && !!stop.stop_id,
    })),
  });

  // Build departuresByStop map from query results
  const departuresByStop: Record<string, DepartureItem[]> = {};
  departureQueries.forEach((q, i) => {
    const stop = stops[i];
    if (stop) departuresByStop[stop.stop_id] = q.data?.departures ?? [];
  });

  // Recommendation for next class
  const recParams = useMemo(() => {
    const nextClass = getNextClassToday(scheduleClasses);
    if (!nextClass) return null;
    const hasCustomDest =
      nextClass.destination_lat != null && nextClass.destination_lng != null;
    return {
      lat: location?.lat ?? UIUC_FALLBACK.lat,
      lng: location?.lng ?? UIUC_FALLBACK.lng,
      ...(hasCustomDest
        ? {
            destination_lat: nextClass.destination_lat!,
            destination_lng: nextClass.destination_lng!,
            destination_name: nextClass.destination_name ?? undefined,
          }
        : { destination_building_id: nextClass.building_id }),
      arrive_by_iso: arriveByIsoToday(nextClass.start_time_local),
      walking_speed_mps: walkingSpeedMps,
      buffer_minutes: bufferMinutes,
      max_options: 4,
      prefer_bus: rainMode,
    };
  }, [scheduleClasses, location, walkingSpeedMps, bufferMinutes, rainMode]);

  const { data: recData } = useRecommendation(recParams);
  const recommendations = recData?.options ?? [];

  // Autocomplete — replaces the debounced fetchAutocomplete useEffect
  const { data: autocompleteData } = useAutocomplete(searchQuery);
  const autocompleteSuggestions = autocompleteData?.results ?? [];
  ```

  Note: `fetchDepartures`, `apiBaseUrl`, `apiKey` are used directly in `useQueries` here since the per-stop query array needs the closure values. Import `fetchDepartures` from `@/src/api/client` (it's likely already imported).

  Also add `useMemo` to the existing react import line if not already there.

- [ ] **Step 6: Remove the loadData function and live interval**

  Find and remove:
  - The entire `const loadData = async () => { ... }` function (or however it is named)
  - The `useEffect(() => { loadData(); ... }, [apiBaseUrl, apiKey, ...])` that triggers it
  - The `useEffect` that sets up `liveIntervalRef.current = setInterval(...)` for 30s refresh
  - The `useEffect` that clears `liveIntervalRef` on unmount
  - The debounced `useEffect` that calls `fetchAutocomplete` (replaced by `useAutocomplete`)

  Keep:
  - The `useEffect` for loading recent searches, favorites, pinned routes from AsyncStorage (line ~199)
  - The `status` state and any location permission effects (location is not server state)

- [ ] **Step 7: Update pull-to-refresh**

  Find the pull-to-refresh handler (the `onRefresh` function). Replace manual `loadData()` call with:
  ```typescript
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["classes"] }),
      queryClient.invalidateQueries({ queryKey: ["nearby-stops"] }),
      queryClient.invalidateQueries({ queryKey: ["departures"] }),
      queryClient.invalidateQueries({ queryKey: ["recommendation"] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);
  ```

  Add at the top of `HomeScreen`:
  ```typescript
  import { useQueryClient } from "@tanstack/react-query";
  // ...
  const queryClient = useQueryClient();
  ```

- [ ] **Step 8: Update loading state**

  Find `status === "loading"` usage. The initial loading state now comes from TQ:
  ```typescript
  const isInitialLoading =
    !location || // waiting for location
    (nearbyStopsData === undefined && !!location); // waiting for first stops fetch
  ```
  Update the `status` state logic accordingly — set `"ready"` once location is available and stops have been fetched at least once.

- [ ] **Step 9: Update offline banner**

  Find the `offlineBanner` state logic. Replace the manual offline detection with:
  ```typescript
  const anyQueryError = departureQueries.some(q => q.isError);
  // Show offline banner if queries are erroring AND we have stale data to show
  const offlineBanner = anyQueryError && departureQueries.some(q => q.data !== undefined);
  ```
  Remove `setOfflineBanner(true/false)` calls in `loadData` (since it's deleted).

- [ ] **Step 10: Remove unused imports**

  Remove from the client import: `fetchClasses`, `fetchNearbyStops`, `fetchRecommendation`, `fetchAutocomplete` (if they were only used in `loadData` — keep `fetchDepartures` as it's used directly in `useQueries`).
  Keep `useApiBaseUrl` — it's needed for `apiBaseUrl`/`apiKey` in the `useQueries` closure even after migration.

- [ ] **Step 11: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | grep "index.tsx" | head -20
  ```
  Fix any TypeScript errors before proceeding. Common issues:
  - `DeparturesFetchedAt` state that was set in `loadData` → can be set to `Date.now()` in a `useEffect` that watches `departureQueries`
  - `classesRef` references → replace with `scheduleClasses` directly
  - `locationRef` still used (ok, keep it)

- [ ] **Step 12: Run all tests to confirm no regressions**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx jest src/queries/ --no-coverage 2>&1 | tail -5
  ```
  Expected: all query tests still pass.

- [ ] **Step 13: Commit**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && git add app/(tabs)/index.tsx && git commit -m "feat: migrate Home screen (index.tsx) to TanStack Query hooks"
  ```
