# TanStack Query Integration Design

## Goal

Replace the ~27 manual `useEffect + useState` data-fetching patterns across all 4 tab screens with TanStack Query (`@tanstack/react-query`), giving users instant tab navigation (cached data renders immediately) and silent background refetching instead of loading spinners on repeat visits.

## Context

The app currently fetches data via a centralized `client.ts` with `fetchWithRetry` (exponential backoff, 3 attempts, 15s timeout, 401 auto-refresh). Each screen manages its own loading/error/data state with separate `useState` declarations (~27 total) and manual `useEffect` fetch sequences. Polling (30s departures on Home, 15s vehicles on Map) is handled with `setInterval`/`clearInterval` in effects.

Existing AsyncStorage caches (`departurePatterns`, `classSummaryCache`, `buildingsCache`, `timetableCache`, `lastKnownHomeData`) are **kept as-is** — they serve specialized purposes (ML prediction, offline snapshots, permanent reference data) that are outside TQ's scope. TQ handles network lifecycle only.

## Scope

**In scope:** All 4 tab screens (`index.tsx`, `schedule.tsx`, `map.tsx`, `activity.tsx`) and `useLeaveBy.ts`.

**Out of scope:** `walk-nav.tsx`, `after-class-planner.tsx`, `running-late.tsx` — these are modal/navigation screens and can be migrated in a follow-up if desired. `fetchAllStopsForRoute` (used only in `walk-nav.tsx`) has no query hook in this spec.

## Architecture

### Package

```bash
npx expo install @tanstack/react-query
```

No persister. Existing AsyncStorage caches cover offline fallback.

### QueryClient (in `_layout.tsx`)

```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,   // data fresh for 30s — no refetch on tab switch within window
      gcTime: 300_000,     // keep unused cache for 5 min
      retry: 1,            // client.ts already retries 3x; keep TQ retry low
    },
  },
});
```

`<QueryClientProvider client={queryClient}>` wraps the app in `_layout.tsx`, outside `<PostHogProvider>`.

### `baseUrl` and `apiKey` in query hooks

Every `client.ts` function takes `baseUrl: string` as its first argument and an optional `{ apiKey }` option. Query hooks obtain these by calling `useApiBaseUrl()` internally:

```ts
// Inside every hook in src/queries/
export function useClasses() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ['classes'],
    queryFn: () => fetchClasses(apiBaseUrl, { apiKey }),
    staleTime: 60_000,
    enabled: !!apiBaseUrl,
  });
}
```

`enabled: !!apiBaseUrl` ensures no requests fire before the base URL is loaded from AsyncStorage.

### Query Hooks Layer (`mobile/src/queries/`)

New directory. The existing `client.ts` functions remain unchanged and become the `queryFn` values.

```
mobile/src/queries/
  schedule.ts        — useClasses, useBuildings, useBuildingSearch(query), useCreateClass, useDeleteClass
  departures.ts      — useDepartures(stopId), useNearbyStops(lat, lng)
  recommendation.ts  — useRecommendation(params)
  map.ts             — useVehicles(), useWalkingRoute(params), useBusRouteStops(params)
  places.ts          — useAutocomplete(query), usePlacesAutocomplete(query), usePlaceDetails(placeId), useGeocode(address)
```

Note: `useRecommendation` lives in its own `recommendation.ts` file because it is used on both the Home screen and in `useLeaveBy.ts` — it is not Map-specific.

Note: There are two distinct autocomplete hooks:
- `useAutocomplete(query)` — wraps `fetchAutocomplete` (backend `/autocomplete`, buildings + Nominatim)
- `usePlacesAutocomplete(query)` — wraps `fetchPlacesAutocomplete` (backend `/places/autocomplete`, Google Places)

Both are used in `schedule.tsx`; `index.tsx` uses `fetchAutocomplete` only.

#### Key configurations

| Hook | staleTime | refetchInterval | Notes |
|------|-----------|-----------------|-------|
| `useClasses` | 60s | — | Invalidated on create/delete mutation |
| `useBuildings` | `Infinity` | — | Permanent reference data |
| `useBuildingSearch(query)` | 30s | — | `enabled: query.length >= 2` |
| `useDepartures(stopId)` | 30s | 30s | Replaces manual 30s polling on Home |
| `useNearbyStops(lat, lng)` | 60s | — | Re-runs when coords change |
| `useVehicles()` | 10s | 15s | Replaces manual 15s setInterval on Map |
| `useRecommendation(params)` | 30s | 30s | `enabled` when params are ready; see query key below |
| `useAutocomplete(query)` | 10s | — | `enabled: query.length >= 2` |
| `usePlacesAutocomplete(query)` | 10s | — | `enabled: query.length >= 2` |
| `usePlaceDetails(placeId)` | `Infinity` | — | Place coords don't change |
| `useGeocode(address)` | 86_400_000 | — | 24h, matches backend TTL |

#### Query key conventions

```ts
['classes']
['buildings']
['building-search', query]
['departures', stopId]
['nearby-stops', lat, lng]
['vehicles']
['recommendation', destLat, destLng, arriveByIso, walkingSpeedMps, bufferMinutes, rainMode]
['autocomplete', query]
['places-autocomplete', query]
['place-details', placeId]
['geocode', address]
['walking-route', originLat, originLng, destLat, destLng]
['bus-route-stops', tripId, boardingStopId, alightingStopId]
```

The recommendation query key includes `walkingSpeedMps`, `bufferMinutes`, and `rainMode` because changing these user settings must bust the cache and trigger a fresh fetch.

#### Mutations

`useCreateClass` and `useDeleteClass` call `queryClient.invalidateQueries({ queryKey: ['classes'] })` on `onSuccess`, triggering an automatic re-fetch of the class list. (v5 object form required — array form is v4 only.)

---

## Screen Migrations

### Home Tab (`app/(tabs)/index.tsx`)

The most complex screen. Cascading dependencies are expressed with `enabled`.

`useNearbyStops` takes `lat: number, lng: number` (not an Expo `LocationObjectCoords` object). The hook destructures from the coords shape:

```tsx
const { location } = useLocation();  // stays as a regular hook

const { data: stops } = useNearbyStops(
  location?.coords.latitude ?? 0,
  location?.coords.longitude ?? 0,
  { enabled: !!location }
);

// One query per stop, all in parallel via useQueries
const departureQueries = useQueries({
  queries: (stops ?? []).map(stop => ({
    queryKey: ['departures', stop.stop_id],
    queryFn: () => fetchDepartures(apiBaseUrl, stop.stop_id, { apiKey }),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })),
});

// Flatten results across all stops:
const allDepartures = departureQueries.flatMap(q => q.data?.departures ?? []);
const departuresLoading = departureQueries.some(q => q.isLoading);

const { data: classes } = useClasses();

const { data: recommendation } = useRecommendation(recParams, {
  enabled: !!recParams,
});
```

Note: `fetchRecommendation` is a POST request. TanStack Query fully supports POST as `queryFn` — no special handling needed.

**What changes:**
- `loadData()` async function removed — replaced by query declarations above
- Manual 30s `refreshDepartures()` interval → `refetchInterval: 30_000` on departure queries
- Manual 30s `refreshRecommendations()` interval → `refetchInterval: 30_000` on recommendation query
- Pull-to-refresh → `queryClient.invalidateQueries({ queryKey: ['departures'] })` + `invalidateQueries({ queryKey: ['recommendation', ...] })`
- `loading` state → `isLoading` from TQ (true only on first load, not background refetches)
- Offline banner → shown when `isError && !data` (stale data continues rendering while offline)
- `lastKnownHomeData` → fed as `placeholderData` (not `initialData`) on cold start. `placeholderData` does not count toward `staleTime`, so TQ always refetches on mount regardless — the stored snapshot just prevents a blank screen during the first load.

### Schedule Tab (`app/(tabs)/schedule.tsx`)

```tsx
const { data: classes, isLoading } = useClasses();
const { data: buildings } = useBuildings();
const { mutate: createClass } = useCreateClass();
const { mutate: deleteClass } = useDeleteClass();
const { data: searchResults } = useBuildingSearch(debouncedQuery);
const { data: placeResults } = usePlacesAutocomplete(debouncedQuery);
```

Loading spinner on repeat visits eliminated. Mutations auto-refresh the list via `invalidateQueries`.

### Map Tab (`app/(tabs)/map.tsx`)

```tsx
const { data: stops } = useNearbyStops(lat, lng, { enabled: !!location });
const { data: vehicles } = useVehicles();  // no route filtering — matches current behavior
const { data: departures } = useDepartures(selectedStop?.stop_id, {
  enabled: !!selectedStop,
});
```

`useVehicles()` with `refetchInterval: 15_000` replaces ~20 lines of `setInterval`/`clearInterval` effect code.

**Polyline fetches** (`useWalkingRoute`, `useBusRouteStops`) are used per route step. The map builds polylines by calling these hooks for each step in the selected route's `steps` array. Since the number of steps varies, `useQueries` handles the per-step parallel pattern (same approach as departure queries on Home):

```tsx
const walkPolylineQueries = useQueries({
  queries: walkSteps.map(step => ({
    queryKey: ['walking-route', step.originLat, step.originLng, step.destLat, step.destLng],
    queryFn: () => fetchWalkingRoute(apiBaseUrl, step, { apiKey }),
    staleTime: 300_000,  // 5 min, matches backend TTL
  })),
});

const busRouteQueries = useQueries({
  queries: rideSteps.map(step => ({
    queryKey: ['bus-route-stops', step.tripId, step.boardingStopId, step.alightingStopId],
    queryFn: () => fetchBusRouteStops(apiBaseUrl, step, { apiKey }),
    staleTime: 300_000,
  })),
});
```

Both `walkSteps` and `rideSteps` are derived from the selected recommendation's `steps` array when it's available.

### Activity Tab (`app/(tabs)/activity.tsx`)

Mostly local AsyncStorage — minimal TQ change. The EOD report becomes a `useMutation`:

```tsx
const { mutate: generateReport, isPending, data: report } = useMutation({
  mutationFn: () => fetchEodReport(apiBaseUrl, payload, { apiKey }),
});
```

Triggered on button press. `isPending` replaces `reportLoading` state; `data` replaces `reportText` state.

### `useLeaveBy.ts` hook

The hook's business logic (weather multiplier, rain mode, `LOOKAHEAD_HOURS` window, option mapping, `noViableBus` computation) is **unchanged**. Only the fetch + interval management is replaced:

- Internal `fetchClasses()` call → `useClasses()` (shared cache with schedule tab — zero duplicate requests)
- Internal `fetchRecommendation()` call → `useRecommendation(params)` (shared cache with Home tab)
- Manual 30s `setInterval` for polling → removed; TQ's `refetchInterval: 30_000` on both hooks handles it

---

## Testing

### Setup

The mobile project has no existing Jest setup. Add:

```bash
npx expo install jest-expo @testing-library/react-native @testing-library/react-hooks
```

Add to `package.json`:
```json
"jest": {
  "preset": "jest-expo"
}
```

### Test utility

```tsx
// mobile/src/test-utils/renderWithQuery.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook } from "@testing-library/react-native";

const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

export function renderWithQuery(ui: React.ReactElement) {
  const client = createTestQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

export function renderHookWithQuery<T>(hook: () => T) {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}
```

### Test files

```
mobile/src/queries/__tests__/
  schedule.test.ts
  departures.test.ts
  recommendation.test.ts
  map.test.ts
  places.test.ts
```

Each test file:
- Mocks the relevant `client.ts` functions with `jest.mock`
- Mocks `useApiBaseUrl` to return `{ apiBaseUrl: 'http://test', apiKey: null }`
- Uses `renderHookWithQuery` wrapper
- Asserts `data`, `isLoading`, `isError` states
- For mutations: asserts `invalidateQueries` fires on success via a spy on `queryClient.invalidateQueries`

TQ's internal caching, deduplication, and retry behavior are not tested — that is the library's responsibility.

---

## Files Created / Modified

**Created:**
- `mobile/src/queries/schedule.ts`
- `mobile/src/queries/departures.ts`
- `mobile/src/queries/recommendation.ts`
- `mobile/src/queries/map.ts`
- `mobile/src/queries/places.ts`
- `mobile/src/queries/__tests__/schedule.test.ts`
- `mobile/src/queries/__tests__/departures.test.ts`
- `mobile/src/queries/__tests__/recommendation.test.ts`
- `mobile/src/queries/__tests__/map.test.ts`
- `mobile/src/queries/__tests__/places.test.ts`
- `mobile/src/test-utils/renderWithQuery.tsx`

**Modified:**
- `mobile/package.json` (add `@tanstack/react-query`, `jest-expo`, `@testing-library/react-native`, `@testing-library/react-hooks`)
- `mobile/app/_layout.tsx` (add `QueryClient` + `QueryClientProvider`)
- `mobile/app/(tabs)/index.tsx` (replace manual fetch sequences)
- `mobile/app/(tabs)/schedule.tsx` (replace manual fetch sequences)
- `mobile/app/(tabs)/map.tsx` (replace manual fetch sequences)
- `mobile/app/(tabs)/activity.tsx` (replace eod report fetch)
- `mobile/src/hooks/useLeaveBy.ts` (replace internal fetch + interval with shared query hooks)

---

## What Is Not Changing

- `mobile/src/api/client.ts` — unchanged; functions become TQ `queryFn` values
- `mobile/src/api/types.ts` — unchanged
- All existing AsyncStorage caches (`lastKnownHomeData`, `classSummaryCache`, `buildingsCache`, `timetableCache`, `departurePatterns`) — unchanged
- `walk-nav.tsx`, `after-class-planner.tsx`, `running-late.tsx` — out of scope
- Backend — no changes
