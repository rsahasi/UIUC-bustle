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
├── APP_DB_PATH=/mnt/data/app.db
├── STOPS_DB_PATH=/mnt/data/stops.db
├── CORS_ORIGINS=https://*.up.railway.app
└── API_KEY_REQUIRED=false
```

**Key decisions:**

- GTFS is read-only static data — baked into the Docker image at build time. `load_gtfs.py` resolves its output path via `Path(__file__).resolve().parent.parent / "data" / "gtfs.db"`, which lands at `/app/data/gtfs.db` inside the image. Only changes when MTD publishes a new feed; rebuilding the image is the upgrade path.
- `app.db` and `stops.db` are user-mutable — persisted on a Railway Volume at `/mnt/data`.
- `settings.py` already has `app_db_path: str = "data/app.db"` and `stops_db_path: str = "data/stops.db"`. `main.py` builds DB paths as `BACKEND_ROOT / settings.app_db_path` and `BACKEND_ROOT / settings.stops_db_path`. Python's `pathlib` replaces the left side when the right operand is an absolute path, so setting `APP_DB_PATH=/mnt/data/app.db` in Railway env vars routes correctly to the volume — **no code changes to `main.py` needed**.
- `mobile/src/config/api.ts` already reads `EXPO_PUBLIC_API_BASE_URL` and falls back to `localhost:8000` — **no code changes needed**. Only `mobile/.env.example` needs the new variable documented.

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
# Script resolves output to /app/data/gtfs.db via __file__
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

Note: `data/gtfs.db` is excluded from the COPY step (don't copy stale local version). The `RUN python scripts/load_gtfs.py` step re-creates it fresh inside the image from the MTD feed.

### Mobile

**`mobile/.env.example`** — add `EXPO_PUBLIC_API_BASE_URL=` alongside existing Sentry/PostHog keys:
```
EXPO_PUBLIC_API_BASE_URL=
EXPO_PUBLIC_SENTRY_DSN=
EXPO_PUBLIC_POSTHOG_API_KEY=
```

No other mobile code changes needed — `mobile/src/config/api.ts` already reads `EXPO_PUBLIC_API_BASE_URL`.

---

## Railway Setup Steps (one-time manual)

1. Create Railway account at railway.app
2. New project → "Deploy from GitHub repo" → select `rsahasi/UIUC-bustle`
3. Set build context to `backend/` in service settings
4. Add Volume: mount path `/mnt/data`, size 1GB
5. Add environment variables:
   - `MTD_API_KEY=<key>`
   - `CLAUDE_API_KEY=<key>`
   - `SENTRY_DSN=<dsn>` (optional)
   - `APP_DB_PATH=/mnt/data/app.db`
   - `STOPS_DB_PATH=/mnt/data/stops.db`
   - `CORS_ORIGINS=https://<subdomain>.up.railway.app`
   - `API_KEY_REQUIRED=false`
6. Set health check path to `/health`
7. Copy the generated `*.up.railway.app` domain
8. Set `EXPO_PUBLIC_API_BASE_URL=https://<subdomain>.up.railway.app` in `mobile/.env`

---

## CORS

`settings.py` already has `cors_origins: str = "*"`. For Railway, set `CORS_ORIGINS=https://<subdomain>.up.railway.app` via env var. The existing CORS middleware reads this correctly.

---

## Error Handling

- **GTFS load failure at build time**: build fails, Railway does not deploy. Fix the script and push again.
- **Volume not mounted**: writes to `app.db` fail with `OperationalError`. Railway dashboard shows mount status; remount and redeploy.
- **Missing env vars**: `settings.py` uses Pydantic defaults — missing optional vars (e.g. `SENTRY_DSN`) silently disable the feature. `MTD_API_KEY` is required for live departures; absence causes graceful API errors (same behavior as local dev).

---

## Testing

- Build Docker image locally: `docker build -t uiuc-bustle-backend ./backend`
- Run locally with volume simulation:
  ```bash
  docker run -p 8000:8000 \
    -v $(pwd)/backend/local_data:/mnt/data \
    -e APP_DB_PATH=/mnt/data/app.db \
    -e STOPS_DB_PATH=/mnt/data/stops.db \
    uiuc-bustle-backend
  ```
- Verify health: `curl http://localhost:8000/health` → `{"status":"ok"}`
- Verify GTFS baked in: `curl http://localhost:8000/gtfs/route-all-stops?route_id=22` returns shape data
- After Railway deploy: set `EXPO_PUBLIC_API_BASE_URL` and reload simulator

---

## Environment Variables Reference

| Variable | Where | Purpose |
|---|---|---|
| `MTD_API_KEY` | Railway dashboard | Live bus departures and vehicles |
| `CLAUDE_API_KEY` | Railway dashboard | AI route ranking and features |
| `SENTRY_DSN` | Railway dashboard | Crash reporting (optional) |
| `APP_DB_PATH` | Railway dashboard | Absolute path to app.db on volume (`/mnt/data/app.db`) |
| `STOPS_DB_PATH` | Railway dashboard | Absolute path to stops.db on volume (`/mnt/data/stops.db`) |
| `CORS_ORIGINS` | Railway dashboard | Allowed frontend origins |
| `API_KEY_REQUIRED` | Railway dashboard | Set true to require X-API-Key on all requests |
| `EXPO_PUBLIC_API_BASE_URL` | `mobile/.env` | Railway backend URL for the mobile app |
