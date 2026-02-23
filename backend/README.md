# UIUC Bus — Backend

FastAPI backend: stops, departures (MTD), buildings, schedule, recommendations.

## Run (one command)

From the **backend** directory:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Requires Python 3.11+, a virtualenv with `pip install -r requirements.txt`, and:

- **MTD_API_KEY** — Champaign-Urbana MTD Developer API key (developer.cumtd.com)
- **data/stops.db** — from `python scripts/load_stops.py`
- **data/app.db** — from `python scripts/seed_buildings.py`

## Telemetry (console)

Structured logs (no PII) include:

- `telemetry route=health|stops_nearby|departures|recommendation`
- `telemetry departures_served cache_hit=true|false stop_id=...`
- `telemetry mtd_timeout` / `mtd_api_error` on MTD failures

## Reliability

- **MTD calls**: 10s timeout, 3 retries with exponential backoff (1s, 2s, 4s). Clear error messages on 502.
- **Departures**: Cached per `(stop_id, minutes)` for 60 seconds.
