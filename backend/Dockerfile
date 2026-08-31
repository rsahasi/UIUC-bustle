FROM python:3.11-slim

WORKDIR /app

# Install deps before copying source — better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bake GTFS into image at build time (read-only static data)
# load_gtfs.py resolves output path via __file__ → writes to /app/data/gtfs.db
RUN python scripts/load_gtfs.py

# Railway mounts the persistent volume here, so DATA_DIR points at it: share links
# and crowding reports must outlive the container's own filesystem. Set here rather
# than left to the operator, because the fallback (<backend>/data) silently loses
# every row on redeploy. A platform env var still overrides this.
RUN mkdir -p /mnt/data
ENV DATA_DIR=/mnt/data

# NOTE: do not add a `USER` here without first proving the runtime user can write to
# the mounted volume. A build-time `chown /mnt/data` only touches the image layer;
# the runtime mount is laid over it root-owned, so a non-root process fails startup
# with "unable to open database file" and the container crash-loops.

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000

# exec so uvicorn replaces the shell as PID 1: a shell would swallow the SIGTERM
# sent on redeploy and uvicorn would be killed before lifespan teardown runs.
CMD ["/bin/sh", "-c", "alembic upgrade head && exec python -m uvicorn main:app --host 0.0.0.0 --port 8000"]
