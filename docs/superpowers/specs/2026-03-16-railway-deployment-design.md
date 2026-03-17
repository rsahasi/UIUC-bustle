# Railway Deployment Design

## Goal

Deploy the UIUC Bustle FastAPI backend to Railway so the app works on real devices without a local server. This is Spec 2a of 3 in the production-readiness sequence:

1. ✅ Spec 1: Sentry + PostHog
2. **Spec 2a (this): Railway deployment**
3. Spec 2b: PostgreSQL migration
4. Spec 2c: Supabase Auth
5. Spec 3: TanStack Query

---

## Architecture

```
Docker image (built by Railway on each push to main)
├── Python 3.11-slim base
├── requirements.txt installed
├── GTFS load script runs at build time → /app/data/gtfs.db baked in
└── uvicorn starts on port 8000

Railway Volume (1GB persistent disk, ~$0.25/month)
└── mounted at /mnt/data
    ├── app.db   ← user schedule + buildings
    └── stops.db ← cached stop data

Railway Environment Variables
├── MTD_API_KEY
├── CLAUDE_API_KEY
├── SENTRY_DSN
├── DATA_DIR=/mnt/data
├── CORS_ORIGINS=https://*.up.railway.app
└── API_KEY_REQUIRED=false
```

**Key decisions:**
- GTFS is read-only static data — baked into the Docker image at build time. Only changes when MTD publishes a new feed (rare); rebuilding the image is the upgrade path.
- `app.db` and `stops.db` are user-mutable — persisted on a Railway Volume at `/mnt/data` so data survives deploys.
- `DATA_DIR` env var separates volume path from baked-in GTFS path. `settings.py` exposes `data_dir`; repos read `settings.data_dir` for app/stops DB paths. GTFS path stays at `./data/gtfs.db` (relative to app, always baked in).

---

## File Changes

### Backend

**`backend/Dockerfile`** — new file:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bake GTFS into image at build time (read-only static data)
RUN python scripts/load_gtfs.py

# Ensure volume mount point exists
RUN mkdir -p /mnt/data

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**`backend/.dockerignore`** — new file:
```
.venv
__pycache__
*.pyc
*.pyo
.env
data/app.db
data/stops.db
data/gtfs.db
.pytest_cache
tests/
```

**`backend/settings.py`** — add `data_dir: str = "./data"`:
```python
data_dir: str = "./data"  # Override with DATA_DIR env var; used for app.db and stops.db
```

**`backend/src/data/buildings_repo.py`** — replace hardcoded `./data/app.db` with `settings.data_dir`:
```python
from settings import settings
DB_PATH = Path(settings.data_dir) / "app.db"
```

**`backend/src/data/stops_repo.py`** — same pattern:
```python
from settings import settings
DB_PATH = Path(settings.data_dir) / "stops.db"
```

Note: `gtfs_repo.py` keeps its path at `./data/gtfs.db` — this is intentional, as GTFS is baked into the image and is NOT on the volume.

### Mobile

**`mobile/src/config/api.ts`** — read `EXPO_PUBLIC_API_BASE_URL` env var:
```typescript
export function getDefaultApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:8000";
}
```

**`mobile/.env.example`** — add the new variable (alongside existing Sentry/PostHog keys):
```
EXPO_PUBLIC_API_BASE_URL=
EXPO_PUBLIC_SENTRY_DSN=
EXPO_PUBLIC_POSTHOG_API_KEY=
```

---

## Railway Setup Steps

These are one-time manual steps (not automated):

1. Create Railway account at railway.app
2. Create new project → "Deploy from GitHub repo" → select `rsahasi/UIUC-bustle`
3. Set build context to `backend/` in service settings
4. Add Volume: mount path `/mnt/data`, size 1GB
5. Add environment variables (all listed above)
6. Set health check path to `/health`
7. Copy the generated `*.up.railway.app` domain
8. Set `EXPO_PUBLIC_API_BASE_URL=https://<your-subdomain>.up.railway.app` in `mobile/.env`

---

## CORS

`settings.py` already has `cors_origins: str = "*"`. For Railway, set `CORS_ORIGINS=https://<subdomain>.up.railway.app` via env var. The existing CORS middleware reads this correctly.

---

## Error Handling

- **GTFS load failure at build time**: build fails, Railway does not deploy. Fix the script and push again.
- **Volume not mounted**: `app.db` writes fail with `OperationalError`. Railway dashboard shows mount status; remount and redeploy.
- **Missing env vars**: `settings.py` uses Pydantic defaults — missing optional vars (e.g. `SENTRY_DSN`) silently disable the feature. `MTD_API_KEY` is required for live departures; absence causes graceful API errors (same behavior as local dev without the key).

---

## Testing

- Build Docker image locally: `docker build -t uiuc-bustle-backend ./backend`
- Run locally with volume simulation: `docker run -p 8000:8000 -v $(pwd)/backend/data:/mnt/data -e DATA_DIR=/mnt/data uiuc-bustle-backend`
- Verify health: `curl http://localhost:8000/health` → `{"status":"ok"}`
- Verify GTFS baked in: `curl http://localhost:8000/gtfs/route-all-stops?route_id=22` returns shape data
- After Railway deploy: set `EXPO_PUBLIC_API_BASE_URL` and reload simulator — departures and recommendations should work

---

## Environment Variables Reference

| Variable | Where | Purpose |
|---|---|---|
| `MTD_API_KEY` | Railway dashboard | Live bus departures and vehicles |
| `CLAUDE_API_KEY` | Railway dashboard | AI route ranking and features |
| `SENTRY_DSN` | Railway dashboard | Crash reporting (optional) |
| `DATA_DIR` | Railway dashboard | Path for app.db and stops.db on volume |
| `CORS_ORIGINS` | Railway dashboard | Allowed frontend origins |
| `API_KEY_REQUIRED` | Railway dashboard | Set true to require X-API-Key on all requests |
| `EXPO_PUBLIC_API_BASE_URL` | `mobile/.env` | Railway backend URL for the mobile app |
