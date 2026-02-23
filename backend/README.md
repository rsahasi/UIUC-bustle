# UIUC Bustle — Backend

FastAPI backend serving stops, live MTD departures, buildings, class schedule, route recommendations, and AI features.

See the [root README](../README.md) for full setup instructions.

## Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Seed data (run once)
python scripts/load_stops.py
python scripts/seed_buildings_from_osm.py

# Start server
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/stops/nearby` | MTD stops within radius |
| GET | `/stops/{id}/departures` | Live departures for a stop |
| GET | `/vehicles` | Live bus positions |
| GET | `/buildings` | All 636 UIUC buildings |
| GET | `/buildings/search?q=` | Fuzzy building name search |
| GET | `/geocode?q=` | Place/address → lat,lng (Nominatim, UIUC-biased, 24h cache) |
| POST | `/recommendation` | Walk + bus route options |
| GET | `/schedule/classes` | List classes |
| POST | `/schedule/classes` | Add a class |
| DELETE | `/schedule/classes/{id}` | Delete a class |
| POST | `/ai/after-class-plan` | Evening trip planner |
| POST | `/ai/eod-report` | End-of-day activity report |
| POST | `/ai/walk-complete` | Walk encouragement message |

## Tests

```bash
python -m pytest tests/ -q   # 35 tests
```
