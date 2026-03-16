# Share My Trip — Design Spec
**Date:** 2026-03-16
**Status:** Approved

---

## Overview

Let a user share a live trip card with a friend via a short URL. The recipient opens a browser page showing the sharer's destination, bus route, current phase (walking / waiting / on bus / arrived), and a live ETA countdown. No app install required for recipients. Links auto-expire on arrival (hard cap: 2 hours).

Also removes the AI-powered schedule import feature to eliminate unnecessary Claude API token usage.

---

## Architecture

**Approach:** Polling share page (backend-hosted).

The mobile app creates a share record via the backend, which stores it in SQLite and returns a short token. The sharer's app updates phase/ETA as the trip progresses. The recipient opens `/t/{token}` — a plain HTML+JS page served by FastAPI — which polls `/share/trips/{token}/status` every 15 seconds.

No WebSockets. No external hosting required. Works for recipients who don't have the app.

---

## Backend

### DB Table: `shared_trips`

Added to the existing `app.db` SQLite database via `init_app_db`.

```sql
CREATE TABLE IF NOT EXISTS shared_trips (
    id           TEXT PRIMARY KEY,   -- 8-char random token
    destination  TEXT NOT NULL,      -- e.g. "Siebel Center"
    route_id     TEXT,               -- e.g. "22" (nullable for walk-only)
    route_name   TEXT,               -- e.g. "Illini"
    stop_name    TEXT,               -- e.g. "Green & Wright"
    phase        TEXT NOT NULL,      -- "walking" | "waiting" | "on_bus" | "arrived"
    eta_epoch    INTEGER,            -- Unix timestamp of estimated arrival
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL    -- created_at + 7200 (2hr hard cap)
);
```

### New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/share/trips` | Create share record. Returns `{ token, url }` |
| `PATCH` | `/share/trips/{token}` | Update phase and/or eta_epoch |
| `GET` | `/share/trips/{token}/status` | Poll for current state (JSON) |
| `GET` | `/t/{token}` | Serve HTML share page |

**POST `/share/trips` request body:**
```json
{
  "destination": "Siebel Center",
  "route_id": "22",
  "route_name": "Illini",
  "stop_name": "Green & Wright",
  "phase": "walking",
  "eta_epoch": 1710000000
}
```
Returns: `{ "token": "x7k2m9qp", "url": "http://<PUBLIC_BASE_URL>/t/x7k2m9qp" }`

The URL base is read from the `PUBLIC_BASE_URL` env var (e.g. `http://192.168.1.5:8000`). Falls back to reconstructing from the request's `Host` header if the env var is unset. This ensures the URL is usable when shared from a phone on the same LAN.

**PATCH `/share/trips/{token}` request body (all fields optional):**
```json
{ "phase": "on_bus", "eta_epoch": 1710000180 }
```
Returns 404 if token not found or already expired. No authentication required — acknowledged as acceptable for a personal trip-sharing feature where tokens are unguessable.

**GET `/share/trips/{token}/status` response:**
```json
{
  "destination": "Siebel Center",
  "route_id": "22",
  "route_name": "Illini",
  "stop_name": "Green & Wright",
  "phase": "on_bus",
  "eta_epoch": 1710000180,
  "expired": false
}
```
If `expires_at <= now` or phase is `"arrived"`: returns `{ "expired": true }`.
Lazy cleanup: on any read where `expires_at < now - 86400` (24h past expiry), DELETE the row.

**GET `/t/{token}`:** Returns `HTMLResponse` with a self-contained share page.

### Token Generation
8-character token using `secrets.token_urlsafe(6)[:8]`. On `UNIQUE constraint failed` INSERT error, retry once with a new token. If second attempt also fails, return HTTP 500.

### Expiry
- Hard cap: `expires_at = created_at + 7200` (2 hours)
- Soft expiry: when phase is patched to `"arrived"`, backend sets `expires_at = now`
- Status endpoint returns `expired: true` if `expires_at <= now`
- Lazy cleanup: rows where `expires_at < now - 86400` are deleted on read (no background job needed)

---

## Mobile App

### Share Trigger 1 — Home Route Card

- A share icon button (lucide `Share2`) appears on the active recommendation card
- On tap: calls `POST /share/trips` with destination, route, stop, and ETA
  - `eta_epoch` computed as: `Math.floor(Date.now() / 1000) + option.eta_minutes * 60`
  - `route_id`, `route_name`, `stop_name` sourced from the RIDE step of the selected `RecommendationOption` (first step where `type === "ride"`)
- On success: calls React Native `Share.share({ message: "...", url: "..." })` with the short URL
- Share message format: *"Someone is heading to [Destination]. Bus [Route] [Headsign] from [Stop]. ETA [Time]."*
- **Home-triggered shares are static** — no subsequent PATCH calls. The share record is created once with the initial snapshot and remains at that phase. If the user also starts walk-nav, the walk-nav trigger creates a separate token.

### Share Trigger 2 — Walk-Nav Screen

- Share icon in HUD top-right corner
- `POST /share/trips` called on first tap; token stored in a `useRef` on the walk-nav screen
- As observable state transitions, silently calls `PATCH /share/trips/{token}`:
  - Nav start / share button tapped → `"walking"` (set at POST time, no PATCH needed)
  - `navPhase` changes to `"bus"` → PATCH `"on_bus"`
  - Completion modal shown (arrival detected) → PATCH `"arrived"`
- The `"waiting"` phase is sent when the user arrives within `ARRIVAL_THRESHOLD_M` (30m) of the boarding stop while still in walking phase — this is the same proximity check that currently triggers the arrival-at-stop detection in walk-nav. No new geofencing logic is required.
- Token stored in a `useRef` on the walk-nav screen

### Phase Mapping

| App state | Phase sent |
|-----------|-----------|
| Share created (walk-nav start) | `walking` (set at POST, no PATCH) |
| Within 30m of boarding stop (walk phase) | `waiting` |
| `navPhase === "bus"` | `on_bus` |
| Arrival modal shown | `arrived` |

### Error Handling
- If `POST /share/trips` fails, show a brief toast — don't block navigation
- PATCH failures are silent (fire-and-forget) — stale phase on recipient is acceptable
- Share URL shown to user even if PATCH later fails

---

## Recipient Share Page (`/t/{token}`)

Served as a self-contained `HTMLResponse` (inline CSS + JS, no external dependencies).

### Layout

```
┌─────────────────────────────┐
│  UIUC Bustle          [●]   │  ← navy header, live dot
├─────────────────────────────┤
│                             │
│  Heading to                 │
│  Siebel Center              │  ← large destination text
│                             │
│  ● ON BUS — Bus 22 Illini   │  ← phase pill (color-coded)
│  ETA 2:43 PM · 4 min away   │  ← live countdown
│                             │
│  From: Green & Wright       │
│  Updates every 15s          │
└─────────────────────────────┘
```

### Phase Pill Colors

| Phase | Color |
|-------|-------|
| `walking` | Blue-gray (#6B7280) |
| `waiting` | Amber (#D97706) |
| `on_bus` | Green (#16A34A) |
| `arrived` | Navy (#13294B) — "Has arrived 🎉" |
| `expired` | Gray — "This trip has ended" |

### JS Behavior

1. On load: fetch `/share/trips/{token}/status`
2. If `expired: true`: render expired state, stop all timers
3. Otherwise: render live state, start two timers:
   - **Poll timer:** `setInterval` every 15s — fetches fresh status from backend, updates phase pill and `eta_epoch`
   - **Countdown timer:** `setInterval` every 1s — recomputes "X min away" from the last known `eta_epoch` and `Date.now()`. This keeps the countdown ticking between polls without waiting 15s for each decrement.
4. ETA displayed as: clock time (formatted from `eta_epoch`) + "X min away" (`Math.max(0, Math.floor((eta_epoch - Date.now()/1000) / 60))`)
5. On `arrived` or `expired` response from poll: clear both intervals, show final state

---

## AI Schedule Import Removal

### Files to delete
- `mobile/app/import-schedule.tsx`

### Code to remove from mobile
- Import Schedule button/link in `mobile/app/(tabs)/schedule.tsx`
- `parseSchedule` function in `mobile/src/api/client.ts`
- `ParsedClass`, `ParseScheduleRequest`, `ParseScheduleResponse`, `ParsedScheduleResponse` types in `mobile/src/api/types.ts` — all are only used by `import-schedule.tsx` and can be deleted entirely
- All re-exports of these types from `mobile/src/api/client.ts`

### Code to remove from backend
- `POST /ai/parse-schedule` endpoint in `backend/main.py`
- `parse_schedule()` method in `backend/src/ai/claude_client.py`
- `ParseScheduleRequest`, `ParseScheduleResponse`, `ParsedClass` Pydantic models in `backend/src/schedule/models.py` — confirmed safe to delete, no other code imports these three models

### Files to delete from backend
- `backend/tests/test_claude_parse_schedule.py` — tests the removed `parse_schedule()` method; delete to avoid orphaned failing tests

### Preserve
- Manual class creation form (`CreateClassRequest`, `POST /schedule/classes`) — unchanged
- All other Claude methods (route ranking, planner, EOD report, encouragement)

---

## Out of Scope

- User profiles / named sharing (name hardcoded as "Someone")
- Live location on map (explicitly excluded, privacy-first)
- Push notifications to recipient
- Share history / tracking
- PATCH endpoint authentication (tokens are unguessable 8-char random strings; acceptable for this use case)

---

## Environment Variables

| Var | Purpose | Default |
|-----|---------|---------|
| `PUBLIC_BASE_URL` | Base URL embedded in share links (e.g. `http://192.168.1.5:8000`) | Derived from request `Host` header |

---

## Testing Checklist

- [ ] `POST /share/trips` returns valid token and URL containing `PUBLIC_BASE_URL`
- [ ] Token collision: second INSERT with same token succeeds (retry logic)
- [ ] `PATCH /share/trips/{token}` updates phase and eta correctly
- [ ] Status endpoint returns `expired: true` after 2-hour hard cap
- [ ] Status endpoint returns `expired: true` after `arrived` PATCH
- [ ] Lazy cleanup: row deleted when read after 24h past expiry
- [ ] Share page renders correctly for each phase
- [ ] Share page countdown ticks every 1s between polls
- [ ] Share page stops all timers on expired state
- [ ] Share button appears on Home route card and triggers native share sheet
- [ ] Home share is static — no PATCH calls fired after creation
- [ ] Walk-nav PATCH fires on `navPhase → "bus"` and on arrival modal
- [ ] Walk-nav "waiting" PATCH fires within 30m of boarding stop
- [ ] Import schedule screen fully removed with no dead navigation links
- [ ] `parseSchedule` and all associated types removed from client.ts and types.ts
- [ ] Backend parse-schedule endpoint and models removed
- [ ] Manual class creation still works after import removal
