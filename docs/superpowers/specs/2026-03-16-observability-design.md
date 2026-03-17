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
- `sentry_sdk.init(dsn=settings.sentry_dsn, integrations=[FastApiIntegration()], traces_sample_rate=0.1)`
- DSN read from `SENTRY_DSN` env var via `settings.py`; if empty, Sentry is silently disabled (dev works without it)
- Excludes `/health` and `/metrics` paths from performance tracing
- Captures all unhandled exceptions with request context (method, path, status code)
- No PII in breadcrumbs: request bodies are not attached

**Mobile (`@sentry/react-native`)**
- Initialize in `mobile/app/_layout.tsx` before root navigator mounts
- `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1 })`
- DSN from `EXPO_PUBLIC_SENTRY_DSN` in `mobile/.env`; no-ops silently if missing
- Captures JS exceptions, native crashes, and slow render spans
- Pre-Supabase user tagging: stable device ID from SecureStore (`uiuc_bus_device_id` key, generated once on first launch with `crypto.randomUUID()`)
- Post-Supabase upgrade: single `Sentry.setUser({ id: supabaseUser.id })` call in auth context — no other changes needed

### PostHog — Product Analytics

**Mobile only** (`posthog-react-native`)
- Backend analytics deferred until user identity (Supabase) is in place
- Initialize in `mobile/app/_layout.tsx` alongside Sentry
- `PostHog.initAsync(process.env.EXPO_PUBLIC_POSTHOG_API_KEY, { host: 'https://us.i.posthog.com' })`
- No-ops silently if API key missing
- `distinct_id`: same stable device ID used for Sentry (from SecureStore)
- Post-Supabase upgrade: `posthog.identify(supabaseUser.id)` — single-file change

**Analytics wrapper**
- `mobile/src/hooks/useAnalytics.ts` — thin hook wrapping `posthog.capture()`
- Call sites import `useAnalytics`, never `posthog` directly
- Enables: easy mocking in tests, single upgrade point for identity

**Tracked events (no PII in properties):**

| Event | Properties |
|---|---|
| `route_viewed` | `route_count`, `next_class_minutes` |
| `class_added` | `has_building`, `has_custom_dest` |
| `share_trip_created` | — |
| `walk_started` | `walking_mode` |
| `bus_phase_entered` | — |
| `trip_completed` | — |
| `schedule_viewed` | — |
| `map_viewed` | — |

---

## File Changes

**Backend:**
- `backend/requirements.txt` — add `sentry-sdk[fastapi]`
- `backend/settings.py` — add `sentry_dsn: str = ""`
- `backend/main.py` — `sentry_sdk.init(...)` before app creation; trace filter for health/metrics

**Mobile:**
- `mobile/package.json` — add `@sentry/react-native`, `posthog-react-native`
- `mobile/app/_layout.tsx` — init both SDKs; generate + store device ID
- `mobile/src/hooks/useAnalytics.ts` — new file, PostHog wrapper hook
- `mobile/.env.example` — document `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_API_KEY`
- Add `capture()` calls at the 8 event sites listed above (in index.tsx, schedule.tsx, walk-nav.tsx, share logic)

---

## Error Handling

- Both SDKs initialized with try/catch guards; app boots normally if init throws
- Network errors from Sentry/PostHog are swallowed (fire-and-forget, no user-facing impact)
- No events captured in test environments (`__DEV__` check before init)

---

## Testing

- Unit test `useAnalytics` hook: mock PostHog, assert `capture` called with correct event name + properties
- Integration: manual verification — trigger each event in simulator, confirm in PostHog Live Events dashboard

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `SENTRY_DSN` | backend `.env` | Sentry project DSN |
| `EXPO_PUBLIC_SENTRY_DSN` | mobile `.env` | Sentry project DSN (mobile) |
| `EXPO_PUBLIC_POSTHOG_API_KEY` | mobile `.env` | PostHog project API key |
