# Observability Implementation Plan: Sentry + PostHog

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentry crash reporting (backend + mobile) and PostHog product analytics (mobile) to UIUC Bustle before launch.

**Architecture:** Backend uses `sentry-sdk[fastapi]` initialized before FastAPI app creation with a `traces_sampler` excluding `/health` and `/metrics`. Mobile uses `@sentry/react-native` + `posthog-react-native` via `PostHogProvider` wrapping the root Stack in `_layout.tsx`. A stable device ID from SecureStore identifies users pre-Supabase. `useAnalytics` wraps PostHog so call sites never import it directly.

**Tech Stack:** `sentry-sdk[fastapi]`, `@sentry/react-native`, `posthog-react-native`, `uuid` (runtime dep, already typed), `expo-secure-store` (already installed)

**Spec:** `docs/superpowers/specs/2026-03-16-observability-design.md`

---

## Chunk 1: Backend

### Task 1: Backend Sentry package + settings

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/settings.py`

- [ ] **Step 1: Add sentry-sdk to requirements.txt**

Open `backend/requirements.txt`. It currently reads:
```
fastapi==0.115.6
uvicorn[standard]==0.32.1
pydantic-settings==2.6.1
httpx==0.28.1
slowapi==0.1.9
pytest==8.3.4
anthropic>=0.40.0
aiosqlite
aiosqlite
```

Add `sentry-sdk[fastapi]` after `httpx`. Remove the duplicate `aiosqlite` line. Result:
```
fastapi==0.115.6
uvicorn[standard]==0.32.1
pydantic-settings==2.6.1
httpx==0.28.1
sentry-sdk[fastapi]
slowapi==0.1.9
pytest==8.3.4
anthropic>=0.40.0
aiosqlite
```

- [ ] **Step 2: Add sentry_dsn field to settings.py**

Open `backend/settings.py`. After the `google_places_api_key` field (last line before `def get_settings()`), add:

```python
    # Sentry error monitoring — set SENTRY_DSN in .env to enable
    sentry_dsn: str = ""
```

The bottom of the `Settings` class should now end with:
```python
    # Google Places API (New) — set GOOGLE_PLACES_API_KEY in .env for place search
    google_places_api_key: str = ""

    # Sentry error monitoring — set SENTRY_DSN in .env to enable
    sentry_dsn: str = ""
```

- [ ] **Step 3: Install the package in the venv**

```bash
cd /Users/25ruhans/UIUC_APP/backend
.venv/bin/pip install sentry-sdk[fastapi]
```

Expected: `Successfully installed sentry-sdk-...`

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt backend/settings.py
git commit -m "feat: add sentry-sdk to backend requirements and settings"
```

---

### Task 2: Backend Sentry init in main.py

**Files:**
- Modify: `backend/main.py:1-45`

- [ ] **Step 1: Add sentry import and init before FastAPI app**

Open `backend/main.py`. After the existing imports block (after line 30, before `settings = get_settings()`), add the Sentry import and `_sentry_traces_sampler` function. Then add `sentry_sdk.init(...)` after `settings = get_settings()`.

Add to the imports section (after the existing `from src.schedule.models import ...` block):

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
```

Note: Do NOT import `StarletteIntegration` — `FastApiIntegration` already inherits from it, and passing both to `integrations=[]` causes a double-registration error.

Add after `settings = get_settings()` (line 32) and before `BACKEND_ROOT = ...`:

```python
def _sentry_traces_sampler(sampling_context: dict) -> float:
    """Exclude health/metrics endpoints from performance tracing.
    Uses .get() defensively — asgi_scope is absent for non-HTTP contexts (e.g. startup tasks).
    """
    path = (sampling_context.get("asgi_scope") or {}).get("path", "")
    if path in ("/health", "/metrics"):
        return 0.0
    return 0.1


if settings.sentry_dsn:
    # Guard ensures sentry_dsn is non-empty before init; empty string raises BadDsn.
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        integrations=[FastApiIntegration()],
        traces_sampler=_sentry_traces_sampler,
        send_default_pii=False,
    )
```

- [ ] **Step 2: Verify backend still starts**

```bash
cd /Users/25ruhans/UIUC_APP/backend
.venv/bin/python3 -c "import main; print('OK')"
```

Expected: `OK` (no errors)

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: init Sentry on backend with traces_sampler excluding /health and /metrics"
```

---

## Chunk 2: Mobile SDK Setup

### Task 3: Mobile packages + app.json Sentry plugin

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/app.json`

Context: `mobile/package.json` has `@types/uuid` in devDependencies but `uuid` is not in production dependencies. Fix this alongside adding the new packages.

- [ ] **Step 1: Install mobile packages**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx expo install @sentry/react-native posthog-react-native uuid
```

This installs the packages and adds them to `package.json`. `uuid` moves to `dependencies`.

Expected: packages installed, `package.json` updated.

- [ ] **Step 2: Verify package.json has all three in dependencies**

```bash
grep -E '"@sentry/react-native"|"posthog-react-native"|"uuid"' package.json
```

Expected: all three listed under `"dependencies"`.

- [ ] **Step 3: Add Sentry Expo config plugin to app.json**

Open `mobile/app.json`. The `plugins` array currently ends with `"expo-secure-store"`. Add `"@sentry/react-native/expo"` as the last entry:

```json
"plugins": [
  "expo-router",
  "expo-background-fetch",
  "expo-location",
  [
    "expo-notifications",
    {
      "icon": "",
      "color": "#13294b",
      "sounds": []
    }
  ],
  "expo-secure-store",
  "@sentry/react-native/expo"
]
```

- [ ] **Step 4: Create mobile/.env.example and mobile/.env**

Create `mobile/.env.example` with the following content (this file does not exist yet):

```
# Sentry error monitoring — get DSN from sentry.io > Project Settings > Client Keys
EXPO_PUBLIC_SENTRY_DSN=

# PostHog product analytics — get from posthog.com > Project Settings > API Keys
EXPO_PUBLIC_POSTHOG_API_KEY=
```

Then create `mobile/.env` from the example for local development (fill in real keys to test the integrations):

```bash
cp mobile/.env.example mobile/.env
```

Note: `mobile/.env` should be in `.gitignore` — verify it is before committing. The `.env.example` file is safe to commit (empty values, just documents the keys).

- [ ] **Step 5: Commit**

```bash
git add mobile/package.json mobile/app.json mobile/.env.example
# Do NOT git add mobile/.env — verify it's in .gitignore first
git commit -m "feat: add @sentry/react-native, posthog-react-native, uuid to mobile packages"
```

---

### Task 4: Device ID utility

**Files:**
- Create: `mobile/src/utils/deviceId.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile/src/utils/__tests__/deviceId.test.ts`:

```typescript
import * as SecureStore from "expo-secure-store";
import { getOrCreateDeviceId } from "../deviceId";

jest.mock("expo-secure-store");

const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;

describe("getOrCreateDeviceId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns existing ID from SecureStore without generating a new one", async () => {
    mockGet.mockResolvedValueOnce("existing-id-123");
    const id = await getOrCreateDeviceId();
    expect(id).toBe("existing-id-123");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("generates and stores a new UUID when none exists", async () => {
    mockGet.mockResolvedValueOnce(null);
    mockSet.mockResolvedValueOnce(undefined);
    const id = await getOrCreateDeviceId();
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(mockSet).toHaveBeenCalledWith("uiuc_bus_device_id", id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx jest src/utils/__tests__/deviceId.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../deviceId'"

- [ ] **Step 3: Implement deviceId.ts**

Create `mobile/src/utils/deviceId.ts`:

```typescript
import * as SecureStore from "expo-secure-store";
import { v4 as uuidv4 } from "uuid";

const DEVICE_ID_KEY = "uiuc_bus_device_id";

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = uuidv4();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx jest src/utils/__tests__/deviceId.test.ts --no-coverage
```

Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add mobile/src/utils/deviceId.ts mobile/src/utils/__tests__/deviceId.test.ts
git commit -m "feat: add getOrCreateDeviceId utility for stable pre-auth device identity"
```

---

### Task 5: SDK init in _layout.tsx

**Files:**
- Modify: `mobile/app/_layout.tsx`

Context: `_layout.tsx` currently imports from expo, react-native, and task manager. We add Sentry init at module level. PostHog wraps the Stack via `PostHogProvider` so `usePostHog()` works in all screens.

**Note on approach:** The spec described `PostHog.initAsync()` (singleton call), but the plan uses `PostHogProvider` (React context approach). `PostHogProvider` is the correct idiomatic pattern for hook-based apps — it's what enables `usePostHog()` in screens and `useAnalytics()` in Task 6. The `disabled` option replaces the spec's "silent no-op if key missing" requirement.

**PostHog identity:** `usePostHog()` must be called inside a child of `PostHogProvider` (not in `RootLayout` itself, which is the provider's parent). We use an `AnalyticsIdentifier` child component rendered inside `PostHogProvider` to call `posthog.identify(deviceId)` — this fulfills the spec's requirement that `distinct_id` = stable device ID.

- [ ] **Step 1: Add Sentry + PostHog imports to _layout.tsx**

At the top of `mobile/app/_layout.tsx`, after the existing imports, add:

```typescript
import * as Sentry from "@sentry/react-native";
import { PostHogProvider, usePostHog } from "posthog-react-native";
import { getOrCreateDeviceId } from "@/src/utils/deviceId";
```

- [ ] **Step 2: Add Sentry init at module level (after imports, before TaskManager.defineTask)**

After all import statements and before `TaskManager.defineTask(...)`, add:

```typescript
// Sentry — init before anything else; no-ops silently when DSN is absent
if (process.env.NODE_ENV !== "test" && process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
```

- [ ] **Step 3: Add AnalyticsIdentifier component (before RootLayout function)**

Before the `export default function RootLayout()` declaration, add this small component. It runs inside `PostHogProvider`'s context so it can call `usePostHog()`:

```typescript
/** Identifies the device in both Sentry and PostHog on first mount. */
function AnalyticsIdentifier() {
  const posthog = usePostHog();
  useEffect(() => {
    getOrCreateDeviceId().then((deviceId) => {
      // PostHog: set stable distinct_id; after Supabase, swap to posthog.identify(user.id)
      posthog?.identify(deviceId);
      // Sentry: tag errors with same device ID
      if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
        Sentry.setUser({ id: deviceId });
      }
    });
  }, [posthog]);
  return null;
}
```

- [ ] **Step 4: Wrap Stack with PostHogProvider + render AnalyticsIdentifier**

In the `return (...)` of `RootLayout`, wrap the existing `<>...</>` with `PostHogProvider` and add `<AnalyticsIdentifier />` as the first child inside the provider:

```tsx
const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;

return (
  <PostHogProvider
    apiKey={posthogKey || ""}
    options={{
      host: "https://us.i.posthog.com",
      disabled: !posthogKey || process.env.NODE_ENV === "test",
    }}
  >
    <AnalyticsIdentifier />
    <>
      <StatusBar style="light" />
      <NotificationRedirect />
      <Stack screenOptions={{ headerShown: false }}>
        {/* ... all existing Stack.Screen entries unchanged ... */}
      </Stack>
    </>
  </PostHogProvider>
);
```

Keep all existing `Stack.Screen` entries exactly as they are — only add the provider wrapper and `<AnalyticsIdentifier />`.

- [ ] **Step 5: Verify app compiles (no TypeScript errors)**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or pre-existing errors only, none new)

- [ ] **Step 6: Commit**

```bash
git add mobile/app/_layout.tsx
git commit -m "feat: init Sentry and PostHog in _layout.tsx with stable device ID"
```

---

## Chunk 3: Analytics Hook + Event Instrumentation

### Task 6: useAnalytics hook (TDD)

**Files:**
- Create: `mobile/src/hooks/useAnalytics.ts`
- Create: `mobile/src/hooks/__tests__/useAnalytics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile/src/hooks/__tests__/useAnalytics.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx jest src/hooks/__tests__/useAnalytics.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../useAnalytics'"

- [ ] **Step 3: Implement useAnalytics.ts**

Create `mobile/src/hooks/useAnalytics.ts`:

```typescript
import { usePostHog } from "posthog-react-native";

export function useAnalytics(): {
  capture: (event: string, properties?: Record<string, unknown>) => void;
} {
  const posthog = usePostHog();
  return {
    capture(event: string, properties?: Record<string, unknown>): void {
      try {
        posthog?.capture(event, properties);
      } catch {
        // swallow — analytics must never crash the app
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx jest src/hooks/__tests__/useAnalytics.test.ts --no-coverage
```

Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add mobile/src/hooks/useAnalytics.ts mobile/src/hooks/__tests__/useAnalytics.test.ts
git commit -m "feat: add useAnalytics hook wrapping PostHog with null-safe capture"
```

---

### Task 7: Events in index.tsx (route_viewed + share_trip_created)

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

Context: `route_viewed` fires when recommendations come back with results. `share_trip_created` fires when the native share sheet is successfully invoked (the existing "Share" button calls `Share.share({ message: buildShareMessage(opt, destName) })`).

- [ ] **Step 1: Import useAnalytics in index.tsx**

In `mobile/app/(tabs)/index.tsx`, after the existing hooks imports (near line 6 alongside `useLeaveBy`, `useRecommendationSettings`, etc.), add:

```typescript
import { useAnalytics } from "@/src/hooks/useAnalytics";
```

- [ ] **Step 2: Call useAnalytics inside the component**

In the `HomeScreen` component body (or whatever the main screen component is named), alongside other hook calls like `useRecommendationSettings()`, add:

```typescript
const { capture } = useAnalytics();
```

- [ ] **Step 3: Fire route_viewed after recommendations load**

Find the block around line 380 where `recommendationsList.length > 0` is checked after the fetch. After `setRecommendations(recommendationsList)` (line 376), add the capture call:

```typescript
setRecommendations(recommendationsList);
if (recommendationsList.length > 0) {
  capture("route_viewed", {
    route_count: recommendationsList.length,
    next_class_minutes: nextClass
      ? Math.round((new Date(arriveByIsoToday(nextClass.start_time_local)).getTime() - Date.now()) / 60000)
      : undefined,
  });
}
```

- [ ] **Step 4: Fire share_trip_created on successful share**

The share button is inside `renderOptionCard` (a function that starts around line 802). Find the `onPress` at ~line 886 inside that function that currently reads:

```typescript
onPress={() => Share.share({ message: buildShareMessage(opt, destName) })}
```

Replace it with an async version that fires the event when the user actually shares (not when they dismiss):

```typescript
onPress={async () => {
  const result = await Share.share({ message: buildShareMessage(opt, destName) });
  if (result.action !== Share.dismissedAction) {
    capture("share_trip_created");
  }
}}
```

Note: `capture` must be in scope here — it comes from `const { capture } = useAnalytics()` called in the parent screen component (`HomeScreen` or equivalent). `renderOptionCard` is an inner function defined inside the component, so it closes over `capture` automatically.

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add mobile/app/(tabs)/index.tsx
git commit -m "feat: capture route_viewed and share_trip_created analytics events"
```

---

### Task 8: Events in schedule.tsx (class_added + schedule_viewed)

**Files:**
- Modify: `mobile/app/(tabs)/schedule.tsx`

Context: `class_added` fires after the `createClass` API call succeeds (~line 235). `schedule_viewed` fires on screen focus using `useFocusEffect`.

- [ ] **Step 1: Import useAnalytics and useFocusEffect in schedule.tsx**

In `mobile/app/(tabs)/schedule.tsx`, add to imports:

```typescript
import { useCallback } from "react";  // already imported — verify it's there, add if missing
import { useFocusEffect } from "expo-router";
import { useAnalytics } from "@/src/hooks/useAnalytics";
```

Note: `useCallback` is already imported at line 19. `useFocusEffect` from `expo-router` is the Expo Router equivalent of React Navigation's.

- [ ] **Step 2: Call useAnalytics in the screen component**

In the main schedule screen component body, add alongside other hooks:

```typescript
const { capture } = useAnalytics();
```

- [ ] **Step 3: Fire schedule_viewed on screen focus**

In the component body, add:

```typescript
useFocusEffect(
  useCallback(() => {
    capture("schedule_viewed");
  }, [capture])
);
```

- [ ] **Step 4: Fire class_added after successful createClass**

Find the success block after `createClass(...)` call (~line 235). After `Haptics.notificationAsync(...)` (~line 235), add:

```typescript
capture("class_added", {
  has_building: !!buildingId,  // true if a UIUC building was selected
  has_custom_dest: locationLat !== null && locationLng !== null,
});
```

Note: Check the variable names in that function — `buildingId` may be named differently. Look at what's passed to `createClass`: if `destination_lat` is set, it's a custom destination. Use whichever variables are in scope.

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add mobile/app/(tabs)/schedule.tsx
git commit -m "feat: capture class_added and schedule_viewed analytics events"
```

---

### Task 9: Events in map.tsx + walk-nav.tsx

**Files:**
- Modify: `mobile/app/(tabs)/map.tsx`
- Modify: `mobile/app/walk-nav.tsx`

#### map.tsx — map_viewed on screen focus

- [ ] **Step 1: Add imports to map.tsx**

```typescript
import { useFocusEffect } from "expo-router";
import { useAnalytics } from "@/src/hooks/useAnalytics";
```

`useCallback` is already imported at line 9.

- [ ] **Step 2: Add useAnalytics call and map_viewed event**

In the main map screen component, add:

```typescript
const { capture } = useAnalytics();

useFocusEffect(
  useCallback(() => {
    capture("map_viewed");
  }, [capture])
);
```

#### walk-nav.tsx — walk_started, bus_phase_entered, trip_completed

- [ ] **Step 3: Add imports to walk-nav.tsx**

```typescript
import { useAnalytics } from "@/src/hooks/useAnalytics";
```

- [ ] **Step 4: Add useAnalytics call in walk-nav.tsx**

In the walk-nav screen component body, alongside other hooks, add:

```typescript
const { capture } = useAnalytics();
```

The `modeId` param is available to pass as `walking_mode`.

- [ ] **Step 5: Fire walk_started on mount**

Add a one-time useEffect for walk_started. The `modeId` param comes from `useLocalSearchParams()` which is already destructured near the top of the file. Add after the existing hooks:

```typescript
// Fire once on mount — intentional empty deps to fire exactly once regardless of re-renders
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  capture("walk_started", { walking_mode: modeId });
}, []);
```

- [ ] **Step 6: Fire bus_phase_entered on navPhase → "bus" transition**

The existing `navPhase` useEffect at line 144–147 only syncs `navPhaseRef`. Add a **new, separate** `useEffect` watching `navPhase` to fire the event:

```typescript
// Fire analytics when user transitions from walking to bus leg
useEffect(() => {
  if (navPhase === "bus") {
    capture("bus_phase_entered");
  }
}, [navPhase, capture]);
```

Add this after the navPhaseRef sync effect (after line 147).

- [ ] **Step 7: Fire trip_completed on arrival**

Find the `useEffect` around line 375 that watches `arrived` and calls `setShowCompletion(true)`. Add the capture call right before or after `setShowCompletion(true)`:

```typescript
useEffect(() => {
  if (arrived) {
    capture("trip_completed");
    if (timerRef.current) clearInterval(timerRef.current);
    setShowCompletion(true);
    // ... rest of existing effect unchanged
```

- [ ] **Step 8: Verify TypeScript**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors

- [ ] **Step 9: Commit**

```bash
git add mobile/app/(tabs)/map.tsx mobile/app/walk-nav.tsx
git commit -m "feat: capture map_viewed, walk_started, bus_phase_entered, trip_completed events"
```

---

### Task 10: Final integration smoke test

**Files:** None — verification only

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/25ruhans/UIUC_APP/mobile
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests pass including the 2 new ones (deviceId + useAnalytics)

- [ ] **Step 2: Run backend import check**

```bash
cd /Users/25ruhans/UIUC_APP/backend
.venv/bin/python3 -c "import main; print('backend OK')"
```

Expected: `backend OK`

- [ ] **Step 3: Verify Sentry init only fires when DSN is set**

```bash
cd /Users/25ruhans/UIUC_APP/backend
.venv/bin/python3 -c "
import os
os.environ['SENTRY_DSN'] = ''
from settings import Settings
s = Settings()
print('sentry_dsn or None:', s.sentry_dsn or None)
"
```

Expected: `sentry_dsn or None: None`

- [ ] **Step 4: Final commit**

```bash
cd /Users/25ruhans/UIUC_APP
git log --oneline -8
```

All 8 observability commits should be visible. Done.
