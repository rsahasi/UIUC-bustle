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

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000

CMD alembic upgrade head && python -m uvicorn main:app --host 0.0.0.0 --port 8000
