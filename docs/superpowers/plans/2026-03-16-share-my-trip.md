# Share My Trip Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live trip sharing via expiring backend-hosted share links, and remove the AI schedule import feature.

**Architecture:** The mobile app POSTs a trip snapshot to a new FastAPI `/share/trips` endpoint, which stores it in SQLite and returns a short token. Recipients open `/t/{token}` — a self-contained HTML page served by FastAPI that polls `/share/trips/{token}/status` every 15 seconds to show live phase and ETA. Walk-nav silently PATCHes phase transitions. The import-schedule screen and its entire backend/frontend chain are deleted.

**Tech Stack:** FastAPI (Python), SQLite, React Native (Expo Router), TypeScript, lucide-react-native

---

## File Structure

### New files
| File | Responsibility |
|------|----------------|
| `backend/src/share/__init__.py` | Package marker |
| `backend/src/share/models.py` | Pydantic request/response models for share endpoints |
| `backend/src/share/repo.py` | SQLite CRUD for `shared_trips` table |
| `backend/src/share/page.py` | Returns the share HTML string (inline CSS + JS) |
| `backend/tests/test_share.py` | Tests for share endpoints |

### Modified files
| File | Change |
|------|--------|
| `backend/src/data/buildings_repo.py` | Add `shared_trips` table creation to `init_app_db` |
| `backend/settings.py` | Add `public_base_url: str = ""` field |
| `backend/main.py` | Add 4 share endpoints; remove `POST /ai/parse-schedule` |
| `backend/src/ai/claude_client.py` | Remove `parse_schedule_text()` method |
| `backend/src/schedule/models.py` | Remove `ParseScheduleRequest`, `ParseScheduleResponse`, `ParsedClass` |
| `mobile/src/api/types.ts` | Add `ShareTripRequest`, `ShareTripResponse`, `ShareTripStatus`; remove `ParsedClass`, `ParsedScheduleResponse` |
| `mobile/src/api/client.ts` | Add `createShareTrip`, `patchShareTrip`; remove `parseSchedule` and its re-exports |
| `mobile/app/(tabs)/index.tsx` | Update existing Share button to use backend share link |
| `mobile/app/walk-nav.tsx` | Add share HUD button; add phase PATCH calls on transitions |
| `mobile/app/(tabs)/schedule.tsx` | Remove two import-schedule navigation buttons |

### Deleted files
| File | Reason |
|------|--------|
| `mobile/app/import-schedule.tsx` | AI schedule import removed |
| `backend/tests/test_claude_parse_schedule.py` | Tests the removed method |

---

## Chunk 1: Backend — Share Module

### Task 1: Create share Pydantic models

**Files:**
- Create: `backend/src/share/__init__.py`
- Create: `backend/src/share/models.py`

- [ ] **Step 1: Create the package and models file**

```python
# backend/src/share/__init__.py
# (empty)
```

```python
# backend/src/share/models.py
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


VALID_PHASES = frozenset({"walking", "waiting", "on_bus", "arrived"})


class CreateShareTripRequest(BaseModel):
    destination: str
    route_id: Optional[str] = None
    route_name: Optional[str] = None
    stop_name: Optional[str] = None
    phase: str = "walking"
    eta_epoch: Optional[int] = None


class CreateShareTripResponse(BaseModel):
    token: str
    url: str


class PatchShareTripRequest(BaseModel):
    phase: Optional[str] = None
    eta_epoch: Optional[int] = None


class ShareTripStatusResponse(BaseModel):
    destination: Optional[str] = None
    route_id: Optional[str] = None
    route_name: Optional[str] = None
    stop_name: Optional[str] = None
    phase: Optional[str] = None
    eta_epoch: Optional[int] = None
    expired: bool = False
```

- [ ] **Step 2: Verify file exists**

```bash
python3 -c "from src.share.models import CreateShareTripRequest; print('ok')"
```
Run from `backend/`. Expected: `ok`

---

### Task 2: Create share repo (SQLite CRUD)

**Files:**
- Create: `backend/src/share/repo.py`

- [ ] **Step 1: Write the repo**

```python
# backend/src/share/repo.py
"""SQLite CRUD for shared_trips table."""
from __future__ import annotations

import secrets
import time
from pathlib import Path
from typing import Optional
import sqlite3

HARD_CAP_SECONDS = 7200        # 2 hours
LAZY_DELETE_GRACE = 86400      # delete rows 24h past expiry on next read


def create_shared_trip(
    db_path: str | Path,
    destination: str,
    route_id: Optional[str],
    route_name: Optional[str],
    stop_name: Optional[str],
    phase: str,
    eta_epoch: Optional[int],
) -> str:
    """Insert a new shared trip. Returns the token. Retries once on collision."""
    now = int(time.time())
    expires_at = now + HARD_CAP_SECONDS
    for _ in range(2):
        token = secrets.token_urlsafe(6)[:8]
        try:
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """INSERT INTO shared_trips
                       (id, destination, route_id, route_name, stop_name, phase, eta_epoch, created_at, expires_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (token, destination, route_id, route_name, stop_name, phase, eta_epoch, now, expires_at),
                )
                conn.commit()
            return token
        except sqlite3.IntegrityError:
            continue  # collision — retry with new token
    raise RuntimeError("Failed to generate unique share token after 2 attempts")


def patch_shared_trip(
    db_path: str | Path,
    token: str,
    phase: Optional[str],
    eta_epoch: Optional[int],
) -> bool:
    """Update phase/eta. Returns False if not found or expired."""
    now = int(time.time())
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT expires_at FROM shared_trips WHERE id = ?", (token,)
        ).fetchone()
        if row is None or row[0] <= now:
            return False
        updates: list[str] = []
        params: list = []
        if phase is not None:
            updates.append("phase = ?")
            params.append(phase)
            if phase == "arrived":
                updates.append("expires_at = ?")
                params.append(now)
        if eta_epoch is not None:
            updates.append("eta_epoch = ?")
            params.append(eta_epoch)
        if not updates:
            return True
        params.append(token)
        conn.execute(f"UPDATE shared_trips SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    return True


def get_shared_trip_status(
    db_path: str | Path,
    token: str,
) -> dict | None:
    """Return trip status dict, or None if not found. Lazy-deletes rows 24h past expiry."""
    now = int(time.time())
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            """SELECT destination, route_id, route_name, stop_name, phase, eta_epoch, expires_at
               FROM shared_trips WHERE id = ?""",
            (token,),
        ).fetchone()
        if row is None:
            return None
        destination, route_id, route_name, stop_name, phase, eta_epoch, expires_at = row
        # Lazy cleanup: delete if 24h past expiry
        if expires_at < now - LAZY_DELETE_GRACE:
            conn.execute("DELETE FROM shared_trips WHERE id = ?", (token,))
            conn.commit()
            return None
        expired = expires_at <= now
        return {
            "destination": destination,
            "route_id": route_id,
            "route_name": route_name,
            "stop_name": stop_name,
            "phase": phase,
            "eta_epoch": eta_epoch,
            "expired": expired,
        }
```

- [ ] **Step 2: Verify import**

```bash
python3 -c "from src.share.repo import create_shared_trip, patch_shared_trip, get_shared_trip_status; print('ok')"
```
Run from `backend/`. Expected: `ok`

---

### Task 3: Add shared_trips table to DB init

**Files:**
- Modify: `backend/src/data/buildings_repo.py`

- [ ] **Step 1: Write the failing test**

Append this test to the end of the existing `backend/tests/test_buildings_schedule.py` (it already imports `init_app_db`, so no new import needed):

```python
def test_shared_trips_table_created(tmp_path):
    """shared_trips table must be created by init_app_db."""
    import sqlite3
    db = tmp_path / "app.db"
    init_app_db(db)
    with sqlite3.connect(db) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "shared_trips" in tables
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && .venv/bin/python3 -m pytest tests/test_buildings_schedule.py::test_shared_trips_table_created -v
```
Expected: FAILED (table does not exist yet)

- [ ] **Step 3: Add shared_trips table creation in init_app_db**

In `backend/src/data/buildings_repo.py`, find the final `conn.commit()` at the end of `init_app_db` (currently the last statement inside the `with sqlite3.connect(db_path) as conn:` block, around line 114). Insert the following block **before** that final `conn.commit()` so both the existing tables and the new table are committed together:

```python
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS shared_trips (
                id           TEXT PRIMARY KEY,
                destination  TEXT NOT NULL,
                route_id     TEXT,
                route_name   TEXT,
                stop_name    TEXT,
                phase        TEXT NOT NULL DEFAULT 'walking',
                eta_epoch    INTEGER,
                created_at   INTEGER NOT NULL,
                expires_at   INTEGER NOT NULL
            )
            """
        )
        conn.commit()
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd backend && .venv/bin/python3 -m pytest tests/test_buildings_schedule.py::test_shared_trips_table_created -v
```
Expected: PASSED

---

### Task 4: Create the HTML share page

**Files:**
- Create: `backend/src/share/page.py`

- [ ] **Step 1: Write the HTML generator**

```python
# backend/src/share/page.py
"""Returns the self-contained HTML string for the share page."""


def build_share_page(token: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UIUC Bustle — Trip Share</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; }}
    .header {{ background: #13294B; color: white; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }}
    .header-title {{ font-size: 17px; font-weight: 700; letter-spacing: 0.3px; }}
    .live-dot {{ width: 8px; height: 8px; border-radius: 50%; background: #4ade80; animation: pulse 1.5s infinite; }}
    @keyframes pulse {{ 0%, 100% {{ opacity: 1; }} 50% {{ opacity: 0.3; }} }}
    .card {{ background: white; border-radius: 16px; margin: 16px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }}
    .label {{ font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }}
    .destination {{ font-size: 28px; font-weight: 800; color: #13294B; line-height: 1.2; margin-bottom: 20px; }}
    .phase-pill {{ display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; }}
    .phase-dot {{ width: 8px; height: 8px; border-radius: 50%; }}
    .phase-walking {{ background: #f3f4f6; color: #6B7280; }} .phase-walking .phase-dot {{ background: #6B7280; }}
    .phase-waiting {{ background: #fef3c7; color: #D97706; }} .phase-waiting .phase-dot {{ background: #D97706; }}
    .phase-on_bus {{ background: #dcfce7; color: #16A34A; }} .phase-on_bus .phase-dot {{ background: #16A34A; }}
    .phase-arrived {{ background: #13294B; color: white; }} .phase-arrived .phase-dot {{ background: white; }}
    .phase-expired {{ background: #f3f4f6; color: #9ca3af; }} .phase-expired .phase-dot {{ background: #9ca3af; }}
    .eta {{ font-size: 22px; font-weight: 700; color: #13294B; margin-bottom: 6px; }}
    .eta-sub {{ font-size: 15px; color: #6b7280; margin-bottom: 16px; }}
    .stop-row {{ display: flex; align-items: center; gap: 8px; padding-top: 16px; border-top: 1px solid #f3f4f6; color: #6b7280; font-size: 14px; }}
    .footer {{ text-align: center; padding: 20px; color: #9ca3af; font-size: 13px; }}
  </style>
</head>
<body>
  <div class="header">
    <span class="header-title">UIUC Bustle</span>
    <div class="live-dot" id="liveDot"></div>
  </div>
  <div class="card">
    <div class="label">Heading to</div>
    <div class="destination" id="destination">Loading…</div>
    <div class="phase-pill phase-walking" id="phasePill">
      <div class="phase-dot"></div>
      <span id="phaseLabel">—</span>
    </div>
    <div class="eta" id="etaTime"></div>
    <div class="eta-sub" id="etaSub"></div>
    <div class="stop-row" id="stopRow" style="display:none">
      <span>From:</span>
      <strong id="stopName"></strong>
    </div>
  </div>
  <div class="footer">Updates every 15s &middot; UIUC Bustle</div>
  <script>
    var TOKEN = {repr(token)};
    var PHASE_LABELS = {{walking:'Walking to stop',waiting:'Waiting at stop',on_bus:'On bus',arrived:'Arrived \U0001f389'}};
    var PHASE_CLASS = {{walking:'phase-walking',waiting:'phase-waiting',on_bus:'phase-on_bus',arrived:'phase-arrived'}};
    var etaEpoch = null, pollTimer = null, countdownTimer = null;

    function fmt12h(epoch) {{
      var d = new Date(epoch * 1000), h = d.getHours(), m = d.getMinutes();
      var p = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
      return h + ':' + String(m).padStart(2,'0') + ' ' + p;
    }}
    function updateCountdown() {{
      if (!etaEpoch) return;
      var mins = Math.max(0, Math.floor((etaEpoch - Date.now()/1000) / 60));
      document.getElementById('etaSub').textContent = mins <= 0 ? 'Arriving now' : mins + ' min away';
    }}
    function showExpired(msg) {{
      clearInterval(pollTimer); clearInterval(countdownTimer);
      document.getElementById('liveDot').style.background = '#d1d5db';
      document.getElementById('phasePill').className = 'phase-pill phase-expired';
      document.getElementById('phaseLabel').textContent = msg || 'Trip ended';
      document.getElementById('etaTime').textContent = '';
      document.getElementById('etaSub').textContent = '';
    }}
    function applyState(data) {{
      document.getElementById('destination').textContent = data.destination || '—';
      etaEpoch = data.eta_epoch || null;
      var pill = document.getElementById('phasePill');
      pill.className = 'phase-pill ' + (PHASE_CLASS[data.phase] || 'phase-expired');
      var routeInfo = data.route_id ? ('Bus ' + data.route_id + (data.route_name ? ' ' + data.route_name : '')) : '';
      var phaseText = PHASE_LABELS[data.phase] || data.phase;
      document.getElementById('phaseLabel').textContent = routeInfo ? phaseText + ' \u00b7 ' + routeInfo : phaseText;
      if (etaEpoch) {{ document.getElementById('etaTime').textContent = 'ETA ' + fmt12h(etaEpoch); updateCountdown(); }}
      else {{ document.getElementById('etaTime').textContent = ''; document.getElementById('etaSub').textContent = ''; }}
      if (data.stop_name) {{
        document.getElementById('stopRow').style.display = 'flex';
        document.getElementById('stopName').textContent = data.stop_name;
      }}
    }}
    function fetchStatus() {{
      fetch('/share/trips/' + TOKEN + '/status')
        .then(function(r) {{ return r.ok ? r.json() : Promise.reject(r.status); }})
        .then(function(data) {{
          if (data.expired) {{ showExpired('This trip has ended'); return; }}
          applyState(data);
        }})
        .catch(function() {{ showExpired('Trip not found'); }});
    }}
    fetchStatus();
    pollTimer = setInterval(fetchStatus, 15000);
    countdownTimer = setInterval(updateCountdown, 1000);
  </script>
</body>
</html>"""
```

- [ ] **Step 2: Verify import**

```bash
python3 -c "from src.share.page import build_share_page; html = build_share_page('test1234'); assert 'UIUC Bustle' in html; print('ok')"
```
Run from `backend/`. Expected: `ok`

---

### Task 5: Add public_base_url to settings

**Files:**
- Modify: `backend/settings.py`

- [ ] **Step 1: Add the field**

In `backend/settings.py`, add this line after the `google_places_api_key` field:

```python
    # Share trips: base URL for share links (e.g. http://192.168.1.5:8000).
    # Falls back to request Host header if unset.
    public_base_url: str = ""
```

---

### Task 6: Add share endpoints to main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add imports at top of main.py**

Add these imports alongside the existing imports at the top of `backend/main.py`:

```python
from fastapi.responses import HTMLResponse
from src.share.models import (
    CreateShareTripRequest,
    CreateShareTripResponse,
    PatchShareTripRequest,
    ShareTripStatusResponse,
    VALID_PHASES,
)
from src.share.repo import create_shared_trip, get_shared_trip_status, patch_shared_trip
from src.share.page import build_share_page
```

- [ ] **Step 2: Add the 4 endpoints**

Add these 4 endpoints to `backend/main.py` (after the existing schedule endpoints, before the AI endpoints):

```python
# ── Share My Trip ──────────────────────────────────────────────────────────────

@app.post("/share/trips", response_model=CreateShareTripResponse)
@limiter.limit("20/minute")
def post_share_trip(request: Request, body: CreateShareTripRequest):
    """Create a new shared trip record. Returns token and shareable URL."""
    if body.phase not in VALID_PHASES:
        raise HTTPException(status_code=400, detail=f"phase must be one of {sorted(VALID_PHASES)}")
    token = create_shared_trip(
        db_path=APP_DB,
        destination=body.destination[:200],
        route_id=body.route_id,
        route_name=body.route_name,
        stop_name=body.stop_name,
        phase=body.phase,
        eta_epoch=body.eta_epoch,
    )
    base = settings.public_base_url.rstrip("/") if settings.public_base_url else str(request.base_url).rstrip("/")
    url = f"{base}/t/{token}"
    return CreateShareTripResponse(token=token, url=url)


@app.patch("/share/trips/{token}")
@limiter.limit("60/minute")
def patch_share_trip(request: Request, token: str, body: PatchShareTripRequest):
    """Update phase and/or eta for a shared trip. Returns 404 if expired or not found."""
    if body.phase is not None and body.phase not in VALID_PHASES:
        raise HTTPException(status_code=400, detail=f"phase must be one of {sorted(VALID_PHASES)}")
    updated = patch_shared_trip(APP_DB, token, body.phase, body.eta_epoch)
    if not updated:
        raise HTTPException(status_code=404, detail="Trip not found or has expired")
    return {"ok": True}


@app.get("/share/trips/{token}/status", response_model=ShareTripStatusResponse)
@limiter.exempt
def get_share_trip_status(request: Request, token: str):
    """Poll current state of a shared trip."""
    status = get_shared_trip_status(APP_DB, token)
    if status is None:
        return ShareTripStatusResponse(expired=True)
    return ShareTripStatusResponse(**status)


@app.get("/t/{token}", response_class=HTMLResponse, include_in_schema=False)
@limiter.exempt
def share_trip_page(request: Request, token: str):
    """Serve the recipient share page."""
    return HTMLResponse(content=build_share_page(token))
```

- [ ] **Step 3: Restart backend and smoke-test**

```bash
# Kill any existing backend on port 8000 first
lsof -ti:8000 | xargs kill -9 2>/dev/null; sleep 1
cd backend && .venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 &
sleep 3
curl -s -X POST http://localhost:8000/share/trips \
  -H "Content-Type: application/json" \
  -d '{"destination":"Siebel Center","route_id":"22","route_name":"Illini","stop_name":"Green & Wright","phase":"walking","eta_epoch":9999999999}' | python3 -m json.tool
```
Expected: JSON with `token` (8 chars) and `url` fields.

---

### Task 7: Write backend share tests

**Files:**
- Create: `backend/tests/test_share.py`

- [ ] **Step 1: Write the tests**

```python
# backend/tests/test_share.py
"""Tests for share trip endpoints and repo."""
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
from src.data.buildings_repo import init_app_db
from src.share.repo import create_shared_trip, get_shared_trip_status, patch_shared_trip


@pytest.fixture
def share_db(tmp_path):
    db = tmp_path / "app.db"
    init_app_db(db)
    return db


@pytest.fixture
def client(share_db):
    main.APP_DB = share_db
    return TestClient(main.app)


# ── Repo unit tests ────────────────────────────────────────────────────────────

def test_create_and_get_trip(share_db):
    token = create_shared_trip(share_db, "Siebel Center", "22", "Illini", "Green & Wright", "walking", 9999999999)
    assert len(token) == 8
    status = get_shared_trip_status(share_db, token)
    assert status is not None
    assert status["destination"] == "Siebel Center"
    assert status["phase"] == "walking"
    assert status["expired"] is False


def test_patch_phase(share_db):
    token = create_shared_trip(share_db, "Siebel Center", "22", "Illini", "Stop A", "walking", None)
    ok = patch_shared_trip(share_db, token, "on_bus", 9999999999)
    assert ok is True
    status = get_shared_trip_status(share_db, token)
    assert status["phase"] == "on_bus"
    assert status["eta_epoch"] == 9999999999


def test_patch_arrived_soft_expires(share_db):
    token = create_shared_trip(share_db, "Siebel", None, None, None, "on_bus", None)
    patch_shared_trip(share_db, token, "arrived", None)
    status = get_shared_trip_status(share_db, token)
    assert status["expired"] is True


def test_get_nonexistent_token(share_db):
    result = get_shared_trip_status(share_db, "notfound")
    assert result is None


def test_patch_nonexistent_returns_false(share_db):
    ok = patch_shared_trip(share_db, "notfound", "on_bus", None)
    assert ok is False


# ── Endpoint integration tests ─────────────────────────────────────────────────

def test_post_share_trip(client):
    r = client.post("/share/trips", json={
        "destination": "Siebel Center",
        "route_id": "22",
        "route_name": "Illini",
        "stop_name": "Green & Wright",
        "phase": "walking",
        "eta_epoch": 9999999999,
    })
    assert r.status_code == 200
    data = r.json()
    assert "token" in data
    assert len(data["token"]) == 8
    assert "/t/" in data["url"]


def test_post_share_trip_invalid_phase(client):
    r = client.post("/share/trips", json={"destination": "Siebel", "phase": "teleporting"})
    assert r.status_code == 400


def test_patch_share_trip(client):
    token = client.post("/share/trips", json={"destination": "Siebel", "phase": "walking"}).json()["token"]
    r = client.patch(f"/share/trips/{token}", json={"phase": "on_bus"})
    assert r.status_code == 200


def test_patch_expired_returns_404(client):
    r = client.patch("/share/trips/notfound", json={"phase": "on_bus"})
    assert r.status_code == 404


def test_get_status(client):
    token = client.post("/share/trips", json={"destination": "Siebel", "phase": "walking", "eta_epoch": 9999999999}).json()["token"]
    r = client.get(f"/share/trips/{token}/status")
    assert r.status_code == 200
    data = r.json()
    assert data["destination"] == "Siebel"
    assert data["expired"] is False


def test_get_status_unknown_token_returns_expired(client):
    r = client.get("/share/trips/unknownXX/status")
    assert r.status_code == 200
    assert r.json()["expired"] is True


def test_share_page_html(client):
    token = client.post("/share/trips", json={"destination": "Siebel", "phase": "walking"}).json()["token"]
    r = client.get(f"/t/{token}")
    assert r.status_code == 200
    assert "UIUC Bustle" in r.text
    assert token in r.text
```

- [ ] **Step 2: Run all share tests**

```bash
cd backend && .venv/bin/python3 -m pytest tests/test_share.py -v
```
Expected: all 12 tests PASSED

- [ ] **Step 3: Run full test suite to check no regressions**

```bash
cd backend && .venv/bin/python3 -m pytest tests/ -v --ignore=tests/test_claude_parse_schedule.py
```
Expected: all tests PASSED

- [ ] **Step 4: Commit**

```bash
cd /Users/25ruhans/UIUC_APP
git add backend/src/share/ backend/tests/test_share.py backend/tests/test_buildings_schedule.py backend/src/data/buildings_repo.py backend/settings.py backend/main.py
git commit -m "feat: add share trip backend — endpoints, repo, HTML page"
```

---

## Chunk 2: Mobile — API Client + Home Card Share

### Task 8: Add share types to mobile API types

**Files:**
- Modify: `mobile/src/api/types.ts`

- [ ] **Step 1: Add share types**

Add the following to the end of `mobile/src/api/types.ts`:

```typescript
/** POST /share/trips */
export interface ShareTripRequest {
  destination: string;
  route_id?: string | null;
  route_name?: string | null;
  stop_name?: string | null;
  phase: "walking" | "waiting" | "on_bus" | "arrived";
  eta_epoch?: number | null;
}

export interface ShareTripResponse {
  token: string;
  url: string;
}

/** PATCH /share/trips/{token} */
export interface PatchShareTripRequest {
  phase?: "walking" | "waiting" | "on_bus" | "arrived";
  eta_epoch?: number | null;
}
```

---

### Task 9: Add share API functions to client.ts

**Files:**
- Modify: `mobile/src/api/client.ts`

- [ ] **Step 1: Add type re-exports**

In `mobile/src/api/client.ts`, add to the existing re-export block:

```typescript
export type { ShareTripRequest, ShareTripResponse, PatchShareTripRequest } from "./types";
```

- [ ] **Step 2: Add createShareTrip and patchShareTrip functions**

Add these two functions to `mobile/src/api/client.ts` (after the last existing fetch function):

```typescript
export async function createShareTrip(
  baseUrl: string,
  body: ShareTripRequest,
  opts?: RequestOptions
): Promise<ShareTripResponse> {
  const res = await fetchWithRetry(`${baseUrl}/share/trips`, "/share/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    apiKey: opts?.apiKey,
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`share_create_failed status=${res.status}`);
  return res.json();
}

/** Fire-and-forget: silently updates phase/eta. Call without await. */
export function patchShareTrip(
  baseUrl: string,
  token: string,
  body: PatchShareTripRequest,
  opts?: RequestOptions
): void {
  fetchWithRetry(`${baseUrl}/share/trips/${token}`, `/share/trips/${token}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    apiKey: opts?.apiKey,
  }).catch(() => {/* silent — stale phase on recipient is acceptable */});
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

---

### Task 10: Update Home card Share button to use backend link

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Add createShareTrip import**

In `mobile/app/(tabs)/index.tsx`, add `createShareTrip` to the existing import from `@/src/api/client`:

```typescript
import { ..., createShareTrip } from "@/src/api/client";
```

Also add `ShareTripRequest` to the type imports from `@/src/api/types`:
```typescript
import type { ..., ShareTripRequest } from "@/src/api/types";
```

- [ ] **Step 2: Add shareToken state**

In the component's state declarations, add:

```typescript
const [shareToken, setShareToken] = useState<string | null>(null);
```

- [ ] **Step 3: Add handleShare function**

Add this callback in the component (after `buildShareMessage`):

```typescript
const handleShare = useCallback(async (opt: RecommendationOption, destName: string) => {
  const rideStep = opt.steps.find((s) => s.type === "RIDE");
  const etaEpoch = Math.floor(Date.now() / 1000) + opt.eta_minutes * 60;
  const body: ShareTripRequest = {
    destination: destName.split(",")[0],
    route_id: rideStep?.route ?? null,
    route_name: rideStep?.headsign ?? null,
    stop_name: rideStep?.stop_name ?? null,
    phase: "walking",
    eta_epoch: etaEpoch,
  };
  const message = buildShareMessage(opt, destName);
  try {
    const result = await createShareTrip(apiBaseUrl, body, { apiKey: apiKey ?? undefined });
    setShareToken(result.token);
    await Share.share({ message: `${message}\n${result.url}`, url: result.url });
  } catch {
    // Fallback to message-only share
    await Share.share({ message });
  }
}, [apiBaseUrl, apiKey, buildShareMessage]);
```

- [ ] **Step 4: Update the Share button in renderOptionCard**

Find the existing Share `Pressable` in `renderOptionCard` (around line 882) and update its `onPress`:

Replace:
```typescript
onPress={() => Share.share({ message: buildShareMessage(opt, destName) })}
```
With:
```typescript
onPress={() => handleShare(opt, destName)}
```

Also update the `accessibilityLabel`:
```typescript
accessibilityLabel="Share trip with live ETA"
```

- [ ] **Step 5: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/25ruhans/UIUC_APP
git add mobile/src/api/types.ts mobile/src/api/client.ts mobile/app/(tabs)/index.tsx
git commit -m "feat: wire Home card share button to backend share link"
```

---

## Chunk 3: Mobile — Walk-Nav Share Trigger

### Task 11: Add share button and phase PATCHes to walk-nav

**Files:**
- Modify: `mobile/app/walk-nav.tsx`

- [ ] **Step 1: Add imports**

In `mobile/app/walk-nav.tsx`, add `Share2` to the lucide import:
```typescript
import { Bus, Flame, Footprints, Share2, Timer, X } from "lucide-react-native";
```

Add `createShareTrip` and `patchShareTrip` to the API client import:
```typescript
import { ..., createShareTrip, patchShareTrip } from "@/src/api/client";
```

Add `Share` to React Native imports:
```typescript
import { ..., Share } from "react-native";
```

Add `ShareTripRequest` to type imports:
```typescript
import type { ..., ShareTripRequest } from "@/src/api/types";
```

- [ ] **Step 2: Add shareTokenRef**

In the component, after `const arrivedRef = useRef(false);`, add:

```typescript
const shareTokenRef = useRef<string | null>(null);
```

- [ ] **Step 3: Add handleWalkNavShare function**

Add this callback inside the component (after the existing `zoomIn`/`zoomOut` functions):

```typescript
const handleWalkNavShare = useCallback(async () => {
  const etaEpoch = Math.floor(Date.now() / 1000) + (distanceM !== null ? Math.floor(distanceM / speedMps) : 0);
  const body: ShareTripRequest = {
    destination: hasFinalDest ? finalDestName : destName,
    route_id: routeId || null,
    route_name: null,
    stop_name: null,
    phase: navPhaseRef.current === "bus" ? "on_bus" : "walking",
    eta_epoch: etaEpoch,
  };
  try {
    const result = await createShareTrip(apiBaseUrl, body, { apiKey: apiKey ?? undefined });
    shareTokenRef.current = result.token;
    const msg = `Heading to ${body.destination}${routeId ? ` · Bus ${routeId}` : ""}. ${result.url}`;
    await Share.share({ message: msg, url: result.url });
  } catch {
    const msg = `Heading to ${body.destination}${routeId ? ` · Bus ${routeId}` : ""}`;
    await Share.share({ message: msg });
  }
}, [apiBaseUrl, apiKey, destName, finalDestName, hasFinalDest, routeId, speedMps, distanceM]);
```

- [ ] **Step 4: Add "waiting" and "on_bus" PATCH on boarding stop arrival**

The `waiting` and `on_bus` phases happen at the same code point: when the user arrives within `ARRIVAL_THRESHOLD_M` (30m) of the boarding stop. There is no earlier proximity trigger in the current code — both phases are emitted in sequence at arrival.

Find the location in `walk-nav.tsx` where `setNavPhase("bus")` is called (inside the boarding stop arrival branch, within the location update `useEffect`). Add two PATCHes: `waiting` immediately before the phase switch (represents "arrived at stop, about to board"), and `on_bus` immediately after:

```typescript
// Just before: setNavPhase("bus")
if (shareTokenRef.current) {
  patchShareTrip(apiBaseUrl, shareTokenRef.current, { phase: "waiting" }, { apiKey: apiKey ?? undefined });
}
setNavPhase("bus");
if (shareTokenRef.current) {
  patchShareTrip(apiBaseUrl, shareTokenRef.current, { phase: "on_bus" }, { apiKey: apiKey ?? undefined });
}
```

Note: both fire at essentially the same instant (the recipient's next 15s poll will show `on_bus`). The `waiting` PATCH is included for correctness per the spec but has no visible effect unless the recipient polls within the milliseconds between the two calls.

- [ ] **Step 5: Add "arrived" PATCH when completion modal shows**

Find where `setShowCompletion(true)` is called (arrival detection). Add immediately before it:

```typescript
if (shareTokenRef.current) {
  patchShareTrip(apiBaseUrl, shareTokenRef.current, { phase: "arrived" }, { apiKey: apiKey ?? undefined });
}
```

- [ ] **Step 6: Add share button to HUD**

Find the HUD view in the JSX (the overlay with X close button, Timer, Footprints, Flame icons). Add a share button to the top-right of the HUD header row:

```typescript
<Pressable
  accessibilityLabel="Share trip"
  accessibilityRole="button"
  onPress={handleWalkNavShare}
  style={styles.hudShareBtn}
>
  <Share2 size={18} color={theme.colors.navy} />
</Pressable>
```

Add the style:
```typescript
hudShareBtn: {
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: "rgba(255,255,255,0.9)",
  justifyContent: "center",
  alignItems: "center",
},
```

- [ ] **Step 7: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 8: Commit**

```bash
cd /Users/25ruhans/UIUC_APP
git add mobile/app/walk-nav.tsx
git commit -m "feat: add walk-nav share button with live phase PATCH calls"
```

---

## Chunk 4: Cleanup — Remove AI Schedule Import

### Task 12: Remove import-schedule mobile screen

**Files:**
- Delete: `mobile/app/import-schedule.tsx`
- Modify: `mobile/app/(tabs)/schedule.tsx`

- [ ] **Step 1: Delete import-schedule.tsx**

```bash
rm mobile/app/import-schedule.tsx
```

- [ ] **Step 2: Remove import-schedule navigation from schedule.tsx**

In `mobile/app/(tabs)/schedule.tsx`, remove the `Sparkles` import from lucide (if no longer used elsewhere in the file) and remove the two navigation buttons that call `router.push('/import-schedule')`.

The two Pressable buttons to remove are at lines ~474 and ~489:

```typescript
// REMOVE this entire Pressable:
<Pressable style={styles.importMoreBtn} onPress={() => router.push('/import-schedule')}>
  ...
</Pressable>

// AND REMOVE this entire Pressable:
<Pressable style={styles.aiImportBtn} onPress={() => router.push('/import-schedule')}>
  ...
</Pressable>
```

After removing, also remove any styles that are now unused (`importMoreBtn`, `aiImportBtn`, etc.) — check they aren't referenced elsewhere in the file first.

- [ ] **Step 3: Verify schedule.tsx still imports and renders correctly**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep schedule
```
Expected: no errors for schedule.tsx

---

### Task 13: Remove AI schedule import types from mobile

**Files:**
- Modify: `mobile/src/api/types.ts`
- Modify: `mobile/src/api/client.ts`

- [ ] **Step 1: Remove ParsedClass and ParsedScheduleResponse from types.ts**

In `mobile/src/api/types.ts`, delete the entire block (lines 119–135):

```typescript
/** POST /ai/parse-schedule */
export interface ParsedClass {
  title: string;
  days_of_week: string[];
  start_time_local: string;
  end_time_local: string | null;
  location_name_raw: string;
  building_id: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_name: string | null;
  resolved: boolean;
}

export interface ParsedScheduleResponse {
  classes: ParsedClass[];
}
```

- [ ] **Step 2: Remove parseSchedule from client.ts**

In `mobile/src/api/client.ts`:
1. Remove the `parseSchedule` function
2. Remove `ParsedClass` and `ParsedScheduleResponse` from the re-export lines at the top of the file (note: `ParseScheduleRequest` does not exist as a frontend type — only the two response-side types do)

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

---

### Task 14: Remove AI parse-schedule from backend

**Files:**
- Delete: `backend/tests/test_claude_parse_schedule.py`
- Modify: `backend/main.py`
- Modify: `backend/src/ai/claude_client.py`
- Modify: `backend/src/schedule/models.py`

- [ ] **Step 1: Delete the test file**

```bash
rm backend/tests/test_claude_parse_schedule.py
```

- [ ] **Step 2: Remove parse-schedule endpoint from main.py**

In `backend/main.py`:
1. Remove `ParseScheduleRequest` and `ParseScheduleResponse` from the schedule models import
2. Remove the entire `@app.post("/ai/parse-schedule")` endpoint function and its decorator

- [ ] **Step 3: Remove parse_schedule_text method from claude_client.py**

In `backend/src/ai/claude_client.py`, remove the `parse_schedule_text()` method.

- [ ] **Step 4: Remove parse models from schedule/models.py**

In `backend/src/schedule/models.py`, remove:
- `ParsedClass` dataclass/model
- `ParseScheduleRequest` model
- `ParseScheduleResponse` model

- [ ] **Step 5: Run backend tests to verify no regressions**

```bash
cd backend && .venv/bin/python3 -m pytest tests/ -v
```
Expected: all tests PASSED (test_claude_parse_schedule.py is now deleted, all others pass)

- [ ] **Step 6: Verify backend starts cleanly**

```bash
cd backend && .venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 &
sleep 3 && curl -s http://localhost:8000/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 7: Commit**

```bash
cd /Users/25ruhans/UIUC_APP
git add -A
git commit -m "chore: remove AI schedule import — screen, endpoint, types, test"
```

---

## Final Verification

- [ ] **End-to-end share flow test**

  1. Open app in simulator
  2. Get a route recommendation on Home screen
  3. Tap Share button on a route card
  4. Confirm native share sheet appears with URL containing `/t/`
  5. Open URL in browser — confirm UIUC Bustle share page loads with destination + phase
  6. Start walk-nav, tap share icon in HUD
  7. Confirm second share link works
  8. Navigate to Schedule tab — confirm no "Import" buttons exist

- [ ] **Expired link test**

  ```bash
  # Create a trip and immediately mark it arrived
  TOKEN=$(curl -s -X POST http://localhost:8000/share/trips \
    -H "Content-Type: application/json" \
    -d '{"destination":"Test","phase":"walking"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  curl -s -X PATCH http://localhost:8000/share/trips/$TOKEN \
    -H "Content-Type: application/json" -d '{"phase":"arrived"}'
  curl -s http://localhost:8000/share/trips/$TOKEN/status
  ```
  Expected: `{"expired": true}`
