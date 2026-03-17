# TanStack Query Integration Design

## Goal

Replace the ~27 manual `useEffect + useState` data-fetching patterns across all 4 tab screens with TanStack Query (`@tanstack/react-query`), giving users instant tab navigation (cached data renders immediately) and silent background refetching instead of loading spinners on repeat visits.

## Context

The app currently fetches data via a centralized `client.ts` with `fetchWithRetry` (exponential backoff, 3 attempts, 15s timeout, 401 auto-refresh). Each screen manages its own loading/error/data state with separate `useState` declarations (~27 total) and manual `useEffect` fetch sequences. Polling (30s departures on Home, 15s vehicles on Map) is handled with `setInterval`/`clearInterval` in effects.

Existing AsyncStorage caches (`departurePatterns`, `classSummaryCache`, `buildingsCache`, `timetableCache`, `lastKnownHomeData`) are **kept as-is** — they serve specialized purposes (ML prediction, offline snapshots, permanent reference data) that are outside TQ's scope. TQ handles network lifecycle only.

## Architecture

### Package

```
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

### Query Hooks Layer (`mobile/src/queries/`)

New directory. The existing `client.ts` functions remain unchanged and become the `queryFn` values.

```
mobile/src/queries/
  schedule.ts    — useClasses, useBuildings, useCreateClass, useDeleteClass
  departures.ts  — useDepartures(stopId), useNearbyStops(lat, lng)
  map.ts         — useVehicles(routeId), useRecommendation(params), useWalkingRoute, useBusRouteStops
  places.ts      — useAutocomplete(query), usePlaceDetails(placeId), useGeocode(address)
```

#### Key configurations

| Hook | staleTime | refetchInterval | Notes |
|------|-----------|-----------------|-------|
| `useClasses` | 60s | — | Invalidated on create/delete mutation |
| `useBuildings` | `Infinity` | — | Permanent reference data |
| `useDepartures` | 30s | 30s | Replaces manual 30s polling on Home |
| `useNearbyStops` | 60s | — | Re-runs when location coords change |
| `useVehicles` | 10s | 15s | Replaces manual 15s setInterval on Map |
| `useRecommendation` | 30s | 30s | `enabled` when params are ready |
| `useAutocomplete` | 10s | — | `enabled: query.length >= 2` |
| `usePlaceDetails` | `Infinity` | — | Place coords don't change |
| `useGeocode` | 24h | — | Matches backend TTL |

#### Query key conventions

```ts
['classes']
['buildings']
['departures', stopId]
['nearby-stops', lat, lng]
['vehicles', routeId]
['recommendation', destLat, destLng, arriveByIso]
['autocomplete', query]
['place-details', placeId]
['geocode', address]
['walking-route', originLat, originLng, destLat, destLng]
['bus-route-stops', tripId, boardingStopId, alightingStopId]
```

#### Mutations

`useCreateClass` and `useDeleteClass` call `queryClient.invalidateQueries({ queryKey: ['classes'] })` on `onSuccess`, triggering an automatic re-fetch of the class list.

---

## Screen Migrations

### Home Tab (`app/(tabs)/index.tsx`)

The most complex screen. Cascading dependencies are expressed with `enabled`:

```tsx
const { location } = useLocation();  // stays as a regular hook

const { data: stops } = useNearbyStops(location?.coords, {
  enabled: !!location,
});

const departureQueries = useQueries({
  queries: (stops ?? []).map(stop => ({
    queryKey: ['departures', stop.stop_id],
    queryFn: () => fetchDepartures(stop.stop_id),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })),
});

const { data: classes } = useClasses();

const { data: recommendation } = useRecommendation(recParams, {
  enabled: !!recParams,
  refetchInterval: 30_000,
});
```

**What changes:**
- `loadData()` async function removed — replaced by the query declarations above
- Manual 30s `refreshDepartures()` interval → `refetchInterval: 30_000` on departure queries
- Manual 30s `refreshRecommendations()` interval → `refetchInterval: 30_000` on recommendation query
- Pull-to-refresh → `queryClient.invalidateQueries(['departures'])` + `invalidateQueries(['recommendation', ...])`
- `loading` state → `isLoading` (true only on first load, not background refetches)
- Offline banner → shown when `isError && !data` (stale data continues rendering while offline)
- `lastKnownHomeData` → still used on cold start (full app restart, no cache), feeds `initialData`

**`useLeaveBy` hook** simplified: consumes `useClasses()` and `useRecommendation()` directly, removing its internal polling. It rides the shared cache — no duplicate network calls.

### Schedule Tab (`app/(tabs)/schedule.tsx`)

```tsx
const { data: classes, isLoading } = useClasses();
const { data: buildings } = useBuildings();
const { mutate: createClass } = useCreateClass();
const { mutate: deleteClass } = useDeleteClass();
```

Loading spinner on repeat visits eliminated. Mutations auto-refresh the list via `invalidateQueries`.

### Map Tab (`app/(tabs)/map.tsx`)

```tsx
const { data: stops } = useNearbyStops(location?.coords, { enabled: !!location });
const { data: vehicles } = useVehicles(activeRouteId, { enabled: !!activeRouteId });
const { data: departures } = useDepartures(selectedStop?.stop_id, {
  enabled: !!selectedStop,
});
```

`useVehicles` with `refetchInterval: 15_000` replaces ~20 lines of `setInterval`/`clearInterval` effect code.

### Activity Tab (`app/(tabs)/activity.tsx`)

Mostly local AsyncStorage — minimal TQ change. `fetchEodReport` becomes a `useMutation` triggered on button press, replacing the manual `try/catch` around the AI report call.

---

## Testing

### Test utility

```tsx
// mobile/src/test-utils/renderWithQuery.tsx
const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

export function renderWithQuery(ui: React.ReactElement) {
  const client = createTestQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
```

### Test files

One file per query domain:

```
mobile/src/queries/__tests__/
  schedule.test.ts
  departures.test.ts
  map.test.ts
  places.test.ts
```

Each test file:
- Mocks the relevant `client.ts` functions
- Uses `renderHook` + `renderWithQuery` wrapper
- Asserts `data`, `isLoading`, `isError` states
- For mutations: asserts `invalidateQueries` fires on success

TQ's internal caching, deduplication, and retry behavior are not tested — that is the library's responsibility.

---

## Files Created / Modified

**Created:**
- `mobile/src/queries/schedule.ts`
- `mobile/src/queries/departures.ts`
- `mobile/src/queries/map.ts`
- `mobile/src/queries/places.ts`
- `mobile/src/queries/__tests__/schedule.test.ts`
- `mobile/src/queries/__tests__/departures.test.ts`
- `mobile/src/queries/__tests__/map.test.ts`
- `mobile/src/queries/__tests__/places.test.ts`
- `mobile/src/test-utils/renderWithQuery.tsx`

**Modified:**
- `mobile/package.json` (add `@tanstack/react-query`)
- `mobile/app/_layout.tsx` (add `QueryClient` + `QueryClientProvider`)
- `mobile/app/(tabs)/index.tsx` (replace manual fetch sequences)
- `mobile/app/(tabs)/schedule.tsx` (replace manual fetch sequences)
- `mobile/app/(tabs)/map.tsx` (replace manual fetch sequences)
- `mobile/app/(tabs)/activity.tsx` (replace eod report fetch)
- `mobile/src/hooks/useLeaveBy.ts` (simplify to consume shared query hooks)

---

## What Is Not Changing

- `mobile/src/api/client.ts` — unchanged; functions become TQ `queryFn` values
- `mobile/src/api/types.ts` — unchanged
- All existing AsyncStorage caches (`lastKnownHomeData`, `classSummaryCache`, `buildingsCache`, `timetableCache`, `departurePatterns`) — unchanged
- Backend — no changes
