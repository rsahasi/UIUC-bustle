# Observability Design: Sentry + PostHog

## Goal

Add crash reporting (Sentry) and product analytics (PostHog) to UIUC Bustle before launch, with zero-friction integration that upgrades automatically when Supabase user identity lands in a future phase.

## Scope

This spec covers **Spec 1 of 3** in the production-readiness sequence:
1. **Spec 1 (this):** Sentry + PostHog
2. Spec 2: Supabase Auth + PostgreSQL + Railway deployment
3. Spec 3: TanStack Query

---

## Architecture

### Sentry — Error Monitoring

**Backend (`sentry-sdk[fastapi]`)**
- Initialize in `backend/main.py` before FastAPI app creation
- `sentry_sdk.init(dsn=settings.sentry_dsn or None, integrations=[FastApiIntegration()], traces_sampler=_sentry_traces_sampler)`
- DSN read from `SENTRY_DSN` env var via `settings.py`; passing `None` silently disables Sentry (empty string `""` raises `BadDsn` — must use `or None`)
- Performance tracing: use `traces_sampler` callback that returns `0.0` for paths `/health` and `/metrics`, `0.1` for all others. Inspect `sampling_context["asgi_scope"]["path"]`.
- Captures all unhandled exceptions with request context (method, path, status code)
- No PII in breadcrumbs: request bodies are not attached

**Mobile (`@sentry/react-native`)**
- Initialize in `mobile/app/_layout.tsx` before root navigator mounts
- `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || undefined, tracesSampleRate: 0.1 })`
- DSN from `EXPO_PUBLIC_SENTRY_DSN` in `mobile/.env`; passing `undefined` silently disables (empty string causes a warning)
- Captures JS exceptions, native crashes, and slow render spans
- Requires Expo config plugin: add `"@sentry/react-native/expo"` to the `plugins` array in `mobile/app.json`
- Pre-Supabase user tagging: stable device ID from SecureStore (`uiuc_bus_device_id` key, generated once on first launch using `import { v4 as uuidv4 } from 'uuid'` — consistent with existing `uuidv4` usage in index.tsx; `uuid` must be added to production dependencies in package.json)
- Post-Supabase upgrade: single `Sentry.setUser({ id: supabaseUser.id })` call in auth context — no other changes needed

### PostHog — Product Analytics

**Mobile only** (`posthog-react-native`)
- Backend analytics deferred until user identity (Supabase) is in place
- Initialize in `mobile/app/_layout.tsx` alongside Sentry
- `PostHog.initAsync(process.env.EXPO_PUBLIC_POSTHOG_API_KEY || undefined, { host: 'https://us.i.posthog.com' })` — US region, deliberate choice for UIUC
- No-ops silently if API key missing (pass `undefined`, not empty string)
- `PostHog.initAsync` is fire-and-forget (not awaited). PostHog's SDK queues events internally until init resolves, so events fired immediately on mount are not dropped.
- `distinct_id`: same stable device ID used for Sentry (from SecureStore)
- Post-Supabase upgrade: `posthog.identify(supabaseUser.id)` — single-file change

**Analytics wrapper**
- `mobile/src/hooks/useAnalytics.ts` — thin hook wrapping `posthog.capture()`
- Return type: `{ capture: (event: string, properties?: Record<string, unknown>) => void }`
- Call sites import `useAnalytics`, never `posthog` directly
- Enables: easy mocking in tests, single upgrade point for identity

**Tracked events (no PII in properties):**

| Event | File | Trigger |
|---|---|---|
| `route_viewed` | `mobile/app/(tabs)/index.tsx` | Route options render with `route_count`, `next_class_minutes` |
| `class_added` | `mobile/app/(tabs)/schedule.tsx` | After successful POST /schedule/classes with `has_building`, `has_custom_dest` |
| `share_trip_created` | `mobile/app/(tabs)/index.tsx` | Inside `handleShare` on successful `createShareTrip()` |
| `walk_started` | `mobile/app/walk-nav.tsx` | On screen mount with `walking_mode` |
| `bus_phase_entered` | `mobile/app/walk-nav.tsx` | On `navPhase` transition to `"bus"` in useEffect |
| `trip_completed` | `mobile/app/walk-nav.tsx` | On arrival (completion modal shown) |
| `schedule_viewed` | `mobile/app/(tabs)/schedule.tsx` | On screen focus |
| `map_viewed` | `mobile/app/(tabs)/map.tsx` | On screen focus |

---

## File Changes

**Backend:**
- `backend/requirements.txt` — add `sentry-sdk[fastapi]`
- `backend/settings.py` — add `sentry_dsn: str = ""`
- `backend/main.py` — `sentry_sdk.init(dsn=settings.sentry_dsn or None, ...)` before app creation; `_sentry_traces_sampler` function excluding `/health` and `/metrics`

**Mobile:**
- `mobile/package.json` — add `@sentry/react-native`, `posthog-react-native`, move `uuid` from devDependencies to dependencies
- `mobile/app.json` — add `"@sentry/react-native/expo"` to `plugins` array (required for native crash capture on iOS/Android)
- `mobile/app/_layout.tsx` — init both SDKs; generate + store device ID via `uuidv4()` + SecureStore
- `mobile/src/hooks/useAnalytics.ts` — new file, PostHog wrapper hook
- `mobile/.env.example` — create with `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_POSTHOG_API_KEY` documented
- `mobile/app/(tabs)/index.tsx` — `route_viewed`, `share_trip_created`
- `mobile/app/(tabs)/schedule.tsx` — `class_added`, `schedule_viewed`
- `mobile/app/(tabs)/map.tsx` — `map_viewed`
- `mobile/app/walk-nav.tsx` — `walk_started`, `bus_phase_entered`, `trip_completed`

---

## Error Handling

- Both SDKs initialized with try/catch guards; app boots normally if init throws
- Network errors from Sentry/PostHog are swallowed (fire-and-forget, no user-facing impact)
- SDK init suppressed in Jest test environment: guard with `process.env.NODE_ENV !== 'test'` (not `__DEV__`, which is also true during simulator dev and would prevent verifying the integration)

---

## Testing

- Unit test `useAnalytics` hook: mock PostHog, assert `capture` called with correct event name + properties
- Integration: manual verification — trigger each event in simulator, confirm in PostHog Live Events dashboard

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `SENTRY_DSN` | `backend/.env` | Sentry project DSN |
| `EXPO_PUBLIC_SENTRY_DSN` | `mobile/.env` | Sentry project DSN (mobile) |
| `EXPO_PUBLIC_POSTHOG_API_KEY` | `mobile/.env` | PostHog project API key |
