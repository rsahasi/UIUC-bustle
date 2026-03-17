# Railway Deployment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `backend/Dockerfile`, `backend/.dockerignore`, and update `mobile/.env.example` so the backend can be deployed to Railway with a single `git push`.

**Architecture:** Python 3.11-slim Docker image bakes GTFS data at build time; user data (app.db, stops.db) persists on a Railway Volume at `/mnt/data`. No application code changes needed — existing `settings.py` fields (`app_db_path`, `stops_db_path`) accept absolute paths via env vars, and `mobile/src/config/api.ts` already reads `EXPO_PUBLIC_API_BASE_URL`.

**Tech Stack:** Docker, Railway, Python 3.11-slim, uvicorn, FastAPI

---

## Chunk 1: Backend Docker files

### Task 1: Create backend/Dockerfile

**Files:**
- Create: `backend/Dockerfile`

Context: The backend lives at `backend/`. `main.py` is the FastAPI entrypoint. `scripts/load_gtfs.py` downloads the MTD GTFS feed and writes to `data/gtfs.db` using a path resolved via `__file__` — when run from `/app`, it writes to `/app/data/gtfs.db`. This is intentionally baked into the image (GTFS is static/read-only data). User-mutable data (`app.db`, `stops.db`) will be placed on a Railway Volume at `/mnt/data` via `APP_DB_PATH`/`STOPS_DB_PATH` env vars.

- [ ] **Step 1: Create the Dockerfile**

Create `backend/Dockerfile` with this exact content:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install deps before copying source — better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bake GTFS into image at build time (read-only static data)
# load_gtfs.py resolves output path via __file__ → writes to /app/data/gtfs.db
RUN python scripts/load_gtfs.py

# Ensure Railway volume mount point exists
RUN mkdir -p /mnt/data

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Commit**

```bash
git add backend/Dockerfile
git commit -m "feat: add Dockerfile for Railway deployment"
```

---

### Task 2: Create backend/.dockerignore

**Files:**
- Create: `backend/.dockerignore`

Context: `.dockerignore` must exclude the `.venv` directory (large, not needed — deps are installed inside the image), `.env` (secrets must not be baked in), and any existing SQLite DB files (GTFS is re-downloaded fresh during build; app.db/stops.db will live on the volume, not in the image).

- [ ] **Step 1: Create .dockerignore**

Create `backend/.dockerignore` with this exact content:

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

- [ ] **Step 2: Verify the file is in the right place**

```bash
ls backend/.dockerignore
```

Expected: file exists (no error)

- [ ] **Step 3: Commit**

```bash
git add backend/.dockerignore
git commit -m "feat: add .dockerignore for Railway deployment"
```

---

### Task 3: Local Docker build smoke test

**Files:** (none — verification only)

Context: Before declaring the Docker work done, verify the image builds successfully locally. The `load_gtfs.py` step downloads the MTD GTFS zip from the internet — this takes 30–120 seconds depending on connection. If the build fails here it means the Dockerfile or script has an issue; fix it before moving on.

- [ ] **Step 1: Build the image**

```bash
docker build -t uiuc-bustle-backend ./backend
```

Expected: build completes with `Successfully built <hash>` or `naming to docker.io/library/uiuc-bustle-backend`. The `load_gtfs.py` step will print progress lines like `Downloading GTFS...` and `Loaded N trips`.

If build fails with a pip install error: check `requirements.txt` for packages that require system libraries (e.g. `psycopg2` needs `libpq-dev`). Switch to `psycopg2-binary` if needed.

If `load_gtfs.py` fails: run it locally first (`cd backend && python scripts/load_gtfs.py`) to debug.

- [ ] **Step 2: Run the container locally**

```bash
mkdir -p /tmp/uiuc-local-data
docker run --rm -p 8001:8000 \
  -v /tmp/uiuc-local-data:/mnt/data \
  -e APP_DB_PATH=/mnt/data/app.db \
  -e STOPS_DB_PATH=/mnt/data/stops.db \
  -e MTD_API_KEY=<your-mtd-api-key> \
  uiuc-bustle-backend
```

Note: using port 8001 externally to avoid conflict with the local backend already running on 8000.

- [ ] **Step 3: Verify health endpoint (in a separate terminal)**

```bash
curl http://localhost:8001/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Verify GTFS is baked in**

```bash
curl "http://localhost:8001/gtfs/route-all-stops?route_id=22" | head -c 200
```

Expected: JSON with route shape data (not empty array `[]`)

- [ ] **Step 5: Stop the container**

Press `Ctrl+C` in the terminal running the container.

- [ ] **Step 6: Commit verification note**

No code changes needed if tests pass. If you had to fix anything (Dockerfile, requirements.txt), commit those fixes now:

```bash
git add backend/Dockerfile backend/requirements.txt
git commit -m "fix: resolve Docker build issues"
```

---

## Chunk 2: Mobile env update

### Task 4: Update mobile/.env.example

**Files:**
- Modify: `mobile/.env.example`

Context: `mobile/src/config/api.ts` already reads `EXPO_PUBLIC_API_BASE_URL` and falls back to `localhost:8000`. No code change needed. We just need to document the variable in `.env.example` so developers (and the Railway setup guide) know to set it.

Current `mobile/.env.example` contents:
```
# Sentry error monitoring — get DSN from sentry.io > Project Settings > Client Keys
EXPO_PUBLIC_SENTRY_DSN=

# PostHog product analytics — get from posthog.com > Project Settings > API Keys
EXPO_PUBLIC_POSTHOG_API_KEY=
```

- [ ] **Step 1: Update .env.example**

Replace the contents of `mobile/.env.example` with:

```
# Backend API URL — set to your Railway deployment URL in production
# Leave empty to use http://localhost:8000 (iOS Simulator default)
EXPO_PUBLIC_API_BASE_URL=

# Sentry error monitoring — get DSN from sentry.io > Project Settings > Client Keys
EXPO_PUBLIC_SENTRY_DSN=

# PostHog product analytics — get from posthog.com > Project Settings > API Keys
EXPO_PUBLIC_POSTHOG_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add mobile/.env.example
git commit -m "docs: add EXPO_PUBLIC_API_BASE_URL to mobile .env.example"
```

---

## Chunk 3: Railway setup guide

### Task 5: Add Railway setup instructions to PRODUCTION.md

**Files:**
- Modify: `backend/PRODUCTION.md` (or create if missing)

Context: The Railway setup steps are manual (browser-based) and can't be automated. They must be documented so anyone can deploy the app. Check if `backend/PRODUCTION.md` already exists — if it does, append a Railway section. If not, create it with just the Railway section.

- [ ] **Step 1: Check if PRODUCTION.md exists**

```bash
ls backend/PRODUCTION.md
```

- [ ] **Step 2: Append Railway deployment section**

If the file exists, append this section. If not, create the file with just this content:

```markdown
## Railway Deployment

### One-time setup

1. Create a Railway account at https://railway.app
2. New project → "Deploy from GitHub repo" → select `rsahasi/UIUC-bustle`
3. In service settings, set **Root Directory** to `backend/`
4. Add a **Volume**: mount path `/mnt/data`, size 1GB
5. Add **Environment Variables**:
   - `MTD_API_KEY=<your key>`
   - `CLAUDE_API_KEY=<your key>`
   - `SENTRY_DSN=<your dsn>` (optional)
   - `APP_DB_PATH=/mnt/data/app.db`
   - `STOPS_DB_PATH=/mnt/data/stops.db`
   - `CORS_ORIGINS=https://<your-subdomain>.up.railway.app`
   - `API_KEY_REQUIRED=false`
6. Set **Health Check Path** to `/health`
7. Deploy — Railway builds the Docker image and runs `load_gtfs.py` during the build

### After deploy

1. Copy your `*.up.railway.app` URL from the Railway dashboard
2. Add to `mobile/.env`:
   ```
   EXPO_PUBLIC_API_BASE_URL=https://<your-subdomain>.up.railway.app
   ```
3. Reload the app — it will now talk to the Railway backend

### Re-deploying

Push to `main` — Railway auto-deploys. GTFS is re-downloaded on every build.
To skip GTFS re-download, consider caching the zip in a future optimization.

### Updating GTFS data

The GTFS feed is baked into the Docker image at build time. To get a fresh feed:
- Push any change to `main` (or trigger a manual deploy in Railway dashboard)
- Railway rebuilds the image and re-runs `load_gtfs.py`
```

- [ ] **Step 3: Commit**

```bash
git add backend/PRODUCTION.md
git commit -m "docs: add Railway deployment instructions to PRODUCTION.md"
```
