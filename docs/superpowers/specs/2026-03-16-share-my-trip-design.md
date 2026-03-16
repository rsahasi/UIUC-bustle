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
Returns: `{ "token": "x7k2m9qp", "url": "http://<host>:8000/t/x7k2m9qp" }`

**PATCH `/share/trips/{token}` request body (all fields optional):**
```json
{ "phase": "on_bus", "eta_epoch": 1710000180 }
```
Returns 404 if token not found or already expired.

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
If `expires_at < now` or phase is `"arrived"`: returns `{ "expired": true }`.

**GET `/t/{token}`:** Returns `HTMLResponse` with a self-contained share page.

### Token Generation
8-character alphanumeric token using `secrets.token_urlsafe(6)[:8]`. Collision probability negligible at this scale.

### Expiry
- Hard cap: `expires_at = created_at + 7200` (2 hours)
- Soft expiry: when phase is patched to `"arrived"`, backend sets `expires_at = now`
- Status endpoint returns `expired: true` if `expires_at <= now`

---

## Mobile App

### Share Trigger 1 — Home Route Card

- A share icon button (lucide `Share2`) appears on the active recommendation card
- On tap: calls `POST /share/trips` with destination, route, stop, and ETA derived from the selected `RecommendationOption`
- On success: calls React Native `Share.share({ message: "...", url: "..." })` with the short URL
- Share message format: *"[Name] is heading to [Destination]. Bus [Route] [Headsign] from [Stop]. ETA [Time]."*
  - Name defaults to "Someone" (no auth/profile in scope)
- Stores the returned token in component state for subsequent PATCH calls

### Share Trigger 2 — Walk-Nav Screen

- Share icon in HUD top-right corner
- Same `POST /share/trips` flow on first tap
- As `navPhase` transitions, silently calls `PATCH /share/trips/{token}`:
  - Nav start → `"walking"`
  - Within 50m of boarding stop (isBusMode) → `"waiting"`
  - Bus phase begins → `"on_bus"`
  - Completion modal shown → `"arrived"`
- Token stored in a `useRef` on the walk-nav screen

### Phase Mapping

| App state | Phase sent |
|-----------|-----------|
| Walking to stop | `walking` |
| Within 50m of boarding stop | `waiting` |
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
2. If `expired: true`: render expired state, stop
3. Otherwise: render live state, start `setInterval` polling every 15s
4. ETA displayed as: clock time (formatted from `eta_epoch`) + "X min away" (computed as `Math.max(0, eta_epoch - Date.now()/1000) / 60`)
5. On `arrived` or `expired` response: clear interval, show final state

---

## AI Schedule Import Removal

### Files to delete
- `mobile/app/import-schedule.tsx`

### Code to remove
- Import Schedule button/link in `mobile/app/(tabs)/schedule.tsx`
- `parseSchedule` function in `mobile/src/api/client.ts`
- `ParseScheduleRequest`, `ParseScheduleResponse`, `ParsedClass` types in `mobile/src/api/types.ts` (if only used by import)
- `POST /ai/parse-schedule` endpoint in `backend/main.py`
- `parse_schedule()` method in `backend/src/ai/claude_client.py`
- Associated Pydantic models in `backend/src/schedule/models.py` if only used by parse

### Preserve
- Manual class creation form (`CreateClassRequest`, `POST /schedule/classes`) — unchanged
- All other Claude methods (route ranking, planner, EOD report, encouragement)

---

## Out of Scope

- User profiles / named sharing ("Veer is heading to…" — name hardcoded as "Someone" for now)
- Live location on map (explicitly excluded, privacy-first)
- Push notifications to recipient
- Share history / tracking

---

## Testing Checklist

- [ ] `POST /share/trips` returns valid token and URL
- [ ] `PATCH /share/trips/{token}` updates phase correctly
- [ ] Status endpoint returns `expired: true` after 2 hours
- [ ] Status endpoint returns `expired: true` after `arrived` patch
- [ ] Share page renders correctly for each phase
- [ ] Share page stops polling on expired state
- [ ] Share button appears on Home route card and triggers native share sheet
- [ ] Walk-nav PATCH calls fire on phase transitions
- [ ] Import schedule screen is fully removed with no dead links
- [ ] Manual class creation still works after import removal
