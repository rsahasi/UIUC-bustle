# PostgreSQL Migration Design

## Goal

Migrate `app.db` and `stops.db` from SQLite to PostgreSQL (Railway managed), replacing raw sqlite3 with asyncpg and Alembic for schema management. `gtfs.db` stays as SQLite baked into the Docker image — it is static read-only data with no benefit from migrating.

This is Spec 2b of the production-readiness sequence:
1. ✅ Spec 1: Sentry + PostHog
2. ✅ Spec 2a: Railway deployment
3. **Spec 2b (this): PostgreSQL migration**
4. Spec 2c: Supabase Auth
5. Spec 3: TanStack Query

---

## Architecture

```
Railway PostgreSQL (managed plugin, auto-provisioned)
└── DATABASE_URL env var (Railway sets this automatically)
    └── asyncpg connection pool (backend/src/data/db.py)
        ├── buildings_repo.py  ← async, uses pool
        ├── stops_repo.py      ← async, uses pool
        └── main.py lifespan   ← init_pool() on startup

Alembic (backend/alembic/)
└── Initial migration: tables + pg_trgm + seed data
└── Future migrations: Spec 2c user auth, etc.

Dockerfile
└── CMD: alembic upgrade head && python -m uvicorn main:app ...

gtfs.db → unchanged (SQLite at /app/data/gtfs.db, baked in image)
```

**Key decisions:**
- Raw SQL throughout — no ORM introduced, matches existing pattern
- asyncpg `$1, $2` placeholders replace sqlite3 `?` placeholders
- `asyncpg.Record` has the same dict-style access as `sqlite3.Row`
- `pool.fetch()` replaces `cursor.fetchall()`, `pool.fetchrow()` replaces `cursor.fetchone()`
- `DATABASE_URL` empty → pool init skipped → endpoints return 503 (same graceful behavior as missing `MTD_API_KEY`)
- FTS5 virtual table → `pg_trgm` GIN index on `buildings.name`
- `init_app_db()` removed entirely — Alembic owns schema creation and migrations
- Stops are no longer cached in a separate local file — they go into PostgreSQL directly

---

## Schema

### Initial Alembic migration

```sql
-- Enable pg_trgm for fuzzy building search (replaces FTS5)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
    user_id TEXT PRIMARY KEY
);
-- Seed default user
INSERT INTO users (user_id) VALUES ('default') ON CONFLICT DO NOTHING;

CREATE TABLE buildings (
    building_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL
);
-- Seed pseudo-building for custom destinations
INSERT INTO buildings (building_id, name, lat, lng)
VALUES ('custom', 'Custom Location', 0.0, 0.0) ON CONFLICT DO NOTHING;

-- GIN index for trigram-based building name search (replaces FTS5)
CREATE INDEX buildings_name_trgm ON buildings USING GIN (name gin_trgm_ops);

CREATE TABLE schedule_classes (
    class_id             TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL REFERENCES users(user_id),
    title                TEXT NOT NULL,
    days_of_week         TEXT NOT NULL,  -- JSON array string e.g. '["MON","WED"]'
    start_time_local     TEXT NOT NULL,
    building_id          TEXT NOT NULL REFERENCES buildings(building_id),
    destination_lat      DOUBLE PRECISION,
    destination_lng      DOUBLE PRECISION,
    destination_name     TEXT,
    end_time_local       TEXT
);
CREATE INDEX schedule_classes_user_id ON schedule_classes (user_id);

CREATE TABLE stops (
    stop_id   TEXT PRIMARY KEY,
    stop_name TEXT NOT NULL,
    lat       DOUBLE PRECISION NOT NULL,
    lng       DOUBLE PRECISION NOT NULL
);
CREATE INDEX stops_lat_lng ON stops (lat, lng);
```

---

## File Changes

### New file: `backend/src/data/db.py`

```python
import asyncpg
from typing import Optional

_pool: Optional[asyncpg.Pool] = None

async def init_pool(database_url: str) -> None:
    global _pool
    _pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)

async def close_pool() -> None:
    if _pool:
        await _pool.close()

def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool
```

### Modified: `backend/settings.py`

Add field:
```python
database_url: str = ""  # PostgreSQL connection URL (Railway sets DATABASE_URL automatically)
```

### Modified: `backend/main.py`

Remove:
```python
STOPS_DB = BACKEND_ROOT / settings.stops_db_path
APP_DB = BACKEND_ROOT / settings.app_db_path
```

Update lifespan:
```python
from src.data.db import init_pool, close_pool

@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.database_url:
        await init_pool(settings.database_url)
    app.state.mtd_client = MTDClient(api_key=settings.mtd_api_key) if settings.mtd_api_key else None
    yield
    await close_pool()
    app.state.mtd_client = None
```

All repo call sites change from `repo_fn(APP_DB, ...)` to `repo_fn(get_pool(), ...)` and become `await repo_fn(...)`.

Endpoints that need the DB and have no pool → return HTTP 503:
```python
from src.data.db import get_pool
try:
    pool = get_pool()
except RuntimeError:
    raise HTTPException(status_code=503, detail="Database unavailable")
```

### Modified: `backend/src/data/buildings_repo.py`

- All functions become `async def`
- `db_path: str | Path` parameter → `pool: asyncpg.Pool`
- `sqlite3` → `asyncpg`
- `?` placeholders → `$1, $2, ...`
- `search_buildings_fts` uses pg_trgm:
  ```sql
  SELECT building_id, name, lat, lng FROM buildings
  WHERE name ILIKE $1 OR similarity(name, $2) > 0.2
  ORDER BY similarity(name, $2) DESC
  LIMIT $3
  ```
- `init_app_db()` function removed entirely

### Modified: `backend/src/data/stops_repo.py`

- All functions become `async def`
- `db_path: str | Path` parameter → `pool: asyncpg.Pool`
- `sqlite3` → `asyncpg`
- `init_db()` function removed entirely
- `search_nearby` bounding-box query stays the same SQL; Haversine filter in Python stays identical

### New files: Alembic

- `backend/alembic.ini` — standard Alembic config; `sqlalchemy.url` left blank (overridden in `env.py`)
- `backend/alembic/env.py` — reads `DATABASE_URL` from settings, uses `asyncpg` driver
- `backend/alembic/versions/0001_initial_schema.py` — initial migration (schema above)

### Modified: `backend/Dockerfile`

Update CMD:
```dockerfile
CMD alembic upgrade head && python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### Modified: `backend/requirements.txt`

Add:
```
asyncpg==0.30.0
alembic==1.14.0
```

### New file: `backend/scripts/migrate_sqlite_to_pg.py`

One-time migration script. Reads from local SQLite files and bulk-inserts into PostgreSQL. Run manually once after Railway PostgreSQL is provisioned:

```bash
DATABASE_URL=postgresql://... python scripts/migrate_sqlite_to_pg.py
```

Migrates: `buildings`, `users`, `schedule_classes`. (Stops are re-populated by the app on demand; no migration needed.)

---

## Railway Setup

In the Railway project dashboard:
1. Add **PostgreSQL** plugin → Railway auto-sets `DATABASE_URL` in service env vars
2. No other env var changes needed

---

## Error Handling

- `DATABASE_URL` missing → pool not initialized → `get_pool()` raises `RuntimeError` → endpoints catch it and return HTTP 503
- `alembic upgrade head` failure → container fails to start → Railway does not cut over traffic (same behavior as GTFS build failure)
- Connection pool exhaustion → asyncpg raises `TooManyConnectionsError` → FastAPI returns 500; Railway's PostgreSQL free tier allows 25 connections; `max_size=10` stays safely under this

---

## Testing

- Unit tests: mock `asyncpg.Pool` in repo tests
- Integration: `pytest-asyncio` + a real PostgreSQL instance (via `DATABASE_URL` in test env)
- After Railway deploy: verify `/schedule/classes`, `/buildings/search`, `/stops/nearby` all return data

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Railway dashboard (auto-set by PostgreSQL plugin) | asyncpg connection string |
