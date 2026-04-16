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
    └── asyncpg connection pool (backend/src/data/db.py)  ← runtime queries
        ├── buildings_repo.py  ← async, uses pool
        ├── stops_repo.py      ← async, uses pool
        └── main.py lifespan   ← init_pool() on startup

Alembic (backend/alembic/)  ← uses psycopg2-binary for sync migration runner
└── Initial migration: tables + pg_trgm + seed data
└── Future migrations: Spec 2c user auth, etc.

Dockerfile
└── CMD: alembic upgrade head && python -m uvicorn main:app ...

gtfs.db → unchanged (SQLite at /app/data/gtfs.db, baked in image)
```

**Key decisions:**
- Raw SQL throughout — no ORM introduced, matches existing pattern
- asyncpg used for the runtime pool (`$1, $2` placeholders, `pool.fetch()`, `pool.fetchrow()`, `pool.execute()`)
- Alembic uses `psycopg2-binary` for its synchronous migration runner — no SQLAlchemy needed. `alembic/env.py` derives a `postgresql://` DSN from `DATABASE_URL` for Alembic, while the app uses `postgresql+asyncpg://` (or plain asyncpg DSN) at runtime.
- `asyncpg.Record` has the same dict-style access as `sqlite3.Row`
- `DATABASE_URL` empty → pool init skipped → endpoints return 503 (same graceful behavior as missing `MTD_API_KEY`)
- FTS5 virtual table + `search_buildings_fts` fallback → single `search_buildings` function using `pg_trgm` GIN index
- `init_app_db()` and `init_db()` removed entirely — Alembic owns schema creation and migrations
- `app_db_path` and `stops_db_path` removed from `settings.py` — replaced by `database_url`
- `aiosqlite` removed from `requirements.txt` — unused after migration

---

## Schema

### Initial Alembic migration (`0001_initial_schema.py`)

```sql
-- Enable pg_trgm for fuzzy building search (replaces FTS5)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
    user_id TEXT PRIMARY KEY
);
INSERT INTO users (user_id) VALUES ('default') ON CONFLICT DO NOTHING;

CREATE TABLE buildings (
    building_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL
);
INSERT INTO buildings (building_id, name, lat, lng)
VALUES ('custom', 'Custom Location', 0.0, 0.0) ON CONFLICT DO NOTHING;

-- GIN index for trigram-based building name search (replaces FTS5)
CREATE INDEX buildings_name_trgm ON buildings USING GIN (name gin_trgm_ops);

CREATE TABLE schedule_classes (
    class_id             TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL REFERENCES users(user_id),
    title                TEXT NOT NULL,
    days_of_week         TEXT NOT NULL,
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

### `backend/requirements.txt`

Add:
```
asyncpg==0.30.0
alembic==1.14.0
psycopg2-binary==2.9.10
```

Remove:
```
aiosqlite
```

### `backend/settings.py`

Add:
```python
database_url: str = ""  # PostgreSQL connection URL (Railway sets DATABASE_URL automatically)
```

Remove:
```python
stops_db_path: str = "data/stops.db"
app_db_path: str = "data/app.db"
```

### New file: `backend/src/data/db.py`

```python
import asyncpg
from typing import Optional

_pool: Optional[asyncpg.Pool] = None

async def init_pool(database_url: str) -> None:
    global _pool
    _pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)

async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None

def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool
```

### `backend/main.py`

Remove module-level constants:
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
    app.state.mtd_client = None
    if settings.database_url:
        await close_pool()
```

All call sites: `repo_fn(APP_DB, ...)` → `await repo_fn(get_pool(), ...)`.

Endpoints that call repo functions wrap `get_pool()` with 503 guard:
```python
from src.data.db import get_pool
try:
    pool = get_pool()
except RuntimeError:
    raise HTTPException(status_code=503, detail="Database unavailable")
```

### `backend/src/data/buildings_repo.py`

All functions become `async def`. `db_path: str | Path` → `pool: asyncpg.Pool`. `init_app_db()` removed.

**Functions to migrate:**

`list_buildings(pool)`:
```python
rows = await pool.fetch("SELECT building_id, name, lat, lng FROM buildings ORDER BY name")
```

`get_building(pool, building_id)`:
```python
row = await pool.fetchrow(
    "SELECT building_id, name, lat, lng FROM buildings WHERE building_id = $1",
    building_id
)
```

`search_buildings(pool, query, limit=6)` — replaces both `search_buildings` and `search_buildings_fts` (FTS5 fallback removed, single pg_trgm-backed function):
```python
pattern = f"%{query}%"
rows = await pool.fetch(
    """
    SELECT building_id, name, lat, lng
    FROM buildings
    WHERE building_id != 'custom'
      AND (name ILIKE $1 OR similarity(name, $2) > 0.2)
    ORDER BY similarity(name, $2) DESC
    LIMIT $3
    """,
    pattern, query, limit
)
```

`create_class(pool, *, title, days_of_week, start_time_local, building_id, user_id, class_id, ...)`:
```python
await pool.execute(
    """INSERT INTO schedule_classes
       (class_id, user_id, title, days_of_week, start_time_local, building_id,
        destination_lat, destination_lng, destination_name, end_time_local)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
    class_id, user_id, title, json.dumps(days_of_week), start_time_local,
    building_id, destination_lat, destination_lng, destination_name, end_time_local
)
```

`delete_class(pool, class_id, user_id)`:
```python
result = await pool.execute(
    "DELETE FROM schedule_classes WHERE class_id = $1 AND user_id = $2",
    class_id, user_id
)
return result == "DELETE 1"
```

`list_classes(pool, user_id)`:
```python
rows = await pool.fetch(
    "SELECT * FROM schedule_classes WHERE user_id = $1 ORDER BY start_time_local, title",
    user_id
)
```

### `backend/src/data/stops_repo.py`

All functions become `async def`. `db_path: str | Path` → `pool: asyncpg.Pool`. `init_db()` removed.

`upsert_stop(pool, stop_id, stop_name, lat, lng)` — replaces any write path:
```python
await pool.execute(
    """INSERT INTO stops (stop_id, stop_name, lat, lng)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stop_id) DO UPDATE SET stop_name=$2, lat=$3, lng=$4""",
    stop_id, stop_name, lat, lng
)
```

`search_nearby(pool, lat, lng, radius_m, limit=10)` — bounding box then Haversine in Python (same logic, asyncpg):
```python
rows = await pool.fetch(
    """SELECT stop_id, stop_name, lat, lng FROM stops
       WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4""",
    lat - dlat, lat + dlat, lng - dlng, lng + dlng
)
# then filter by Haversine distance in Python (unchanged)
```

### Alembic files

**`backend/alembic.ini`** — standard Alembic config. `sqlalchemy.url` left blank (overridden in `env.py`).

**`backend/alembic/env.py`** — uses `psycopg2-binary` for sync migration runner:
```python
from alembic import context
from settings import settings

# Alembic uses psycopg2 (sync); strip asyncpg driver prefix if present
url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
context.configure(url=url, ...)
```

**`backend/alembic/versions/0001_initial_schema.py`** — contains the SQL from the Schema section above.

### `backend/Dockerfile`

Update CMD:
```dockerfile
CMD alembic upgrade head && python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### New file: `backend/scripts/migrate_sqlite_to_pg.py`

One-time script. Reads `backend/data/app.db` and bulk-inserts `buildings`, `users`, `schedule_classes` into PostgreSQL. Stops are excluded (re-populated on demand by the app).

```bash
# Run once after Railway PostgreSQL is provisioned:
DATABASE_URL=postgresql://... python scripts/migrate_sqlite_to_pg.py
```

---

## Railway Setup

In the Railway project dashboard:
1. Add **PostgreSQL** plugin to existing project
2. Railway auto-sets `DATABASE_URL` in the service env vars — no manual configuration needed

---

## Error Handling

- `DATABASE_URL` missing → pool not initialized → `get_pool()` raises `RuntimeError` → endpoints return HTTP 503
- `alembic upgrade head` failure → container fails to start → Railway does not cut over traffic
- Connection pool exhaustion → asyncpg raises `TooManyConnectionsError` → 500; Railway PostgreSQL free tier allows 25 connections; `max_size=10` stays safely under this

---

## Testing

- Unit tests: mock `asyncpg.Pool` in repo tests using `unittest.mock.AsyncMock`
- Integration: `pytest-asyncio` + a real PostgreSQL instance (via `DATABASE_URL` in test env)
- After Railway deploy: verify `/schedule/classes`, `/buildings/search`, `/stops/nearby` all return data

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Railway dashboard (auto-set by PostgreSQL plugin) | asyncpg + Alembic connection string |
