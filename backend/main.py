import asyncio
import logging
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from settings import get_settings
from src.data.buildings_repo import create_class, delete_class, init_app_db, list_buildings, list_classes, search_buildings
from src.data.stops_repo import search_nearby
from src.middleware import OptionalAPIKeyMiddleware, RequestLoggingMiddleware, get_valid_api_keys
from src.monitoring import get_metrics
from src.mtd.client import MTDClient
from src.mtd.models import DeparturesResponse, NearbyStopsResponse, StopInfo
from src.recommendation.models import RecommendationOption, RecommendationRequest, RecommendationResponse
from src.recommendation.service import compute_recommendations
from src.schedule.models import (
    BuildingsListResponse,
    BuildingResponse,
    ClassResponse,
    ClassesListResponse,
    CreateClassRequest,
)

settings = get_settings()
BACKEND_ROOT = Path(__file__).resolve().parent
STOPS_DB = BACKEND_ROOT / settings.stops_db_path
APP_DB = BACKEND_ROOT / settings.app_db_path
GTFS_DB = BACKEND_ROOT / "data" / "gtfs.db"

# Structured logging: include module and level; handlers can add JSON later
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])

# Input validation bounds (public robustness)
LAT_MIN, LAT_MAX = -90.0, 90.0
LNG_MIN, LNG_MAX = -180.0, 180.0
RADIUS_M_MIN, RADIUS_M_MAX = 100, 5000
DEPARTURES_MINUTES_MIN, DEPARTURES_MINUTES_MAX = 1, 120
STOP_ID_MAX_LEN = 64
STOP_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\-]+$")


def _validate_lat_lng(lat: float, lng: float) -> None:
    if not (LAT_MIN <= lat <= LAT_MAX):
        raise HTTPException(status_code=400, detail=f"lat must be between {LAT_MIN} and {LAT_MAX}")
    if not (LNG_MIN <= lng <= LNG_MAX):
        raise HTTPException(status_code=400, detail=f"lng must be between {LNG_MIN} and {LNG_MAX}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_app_db(APP_DB)
    app.state.mtd_client = MTDClient(api_key=settings.mtd_api_key) if settings.mtd_api_key else None
    yield
    app.state.mtd_client = None


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
def unhandled_exception_handler(request: Request, exc: Exception):
    """Return consistent JSON error for unhandled exceptions (500). Skip validation/HTTP errors."""
    from fastapi.exceptions import RequestValidationError
    if isinstance(exc, (HTTPException, RequestValidationError)):
        raise exc
    logger.exception("telemetry unhandled_exception path=%s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again later."},
    )


# Order: last added = innermost. So RequestLogging runs first (outermost), then Auth, then CORS.
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    OptionalAPIKeyMiddleware,
    api_key_required=settings.api_key_required,
    api_keys=get_valid_api_keys(settings.api_keys),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/favicon.ico", include_in_schema=False)
@limiter.exempt
def favicon(request: Request):
    """Return 204 so browser favicon requests don't log 404."""
    return Response(status_code=204)


@app.get("/health")
@limiter.exempt
def health(request: Request):
    logger.info("telemetry route=health")
    return {"status": "ok"}


@app.get("/metrics")
@limiter.exempt
def metrics(request: Request):
    """Simple metrics for monitoring (request counts, uptime). Production: use Prometheus exporter if needed."""
    return get_metrics()


# --- Geocoding (for "Where to?" search: address/place name → lat/lng) ---
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
GEOCODE_USER_AGENT = "UIUC-Bus-App/1.0 (uiuc-bus-app-dev)"
# Wider C-U viewbox: lon_min, lat_max, lon_max, lat_min
NOMINATIM_VIEWBOX = "-88.30,40.15,-88.17,40.07"
_LOCATION_HINTS = frozenset(["champaign", "urbana", "illinois", " il,", "uiuc", "university of illinois"])
GEOCODE_CACHE_TTL = 86400  # 24 hours in seconds
GEOCODE_CACHE_MAX = 1000

# Cache: query_string → (result_dict, expires_at)
_geocode_cache: dict[str, tuple[dict, float]] = {}
# Rate limiter: max 1 Nominatim request per second
_nominatim_semaphore = asyncio.Semaphore(1)


async def _nominatim_lookup(query: str) -> dict:
    """Call Nominatim with a 1 req/sec rate limit and 24h result cache."""
    import httpx

    # Cache hit
    if query in _geocode_cache:
        result, expires_at = _geocode_cache[query]
        if time.time() < expires_at:
            return result

    async with _nominatim_semaphore:
        # Double-check cache inside semaphore (another coroutine may have filled it)
        if query in _geocode_cache:
            result, expires_at = _geocode_cache[query]
            if time.time() < expires_at:
                return result

        # Add Champaign, IL context if the query has no location hints
        contextual_query = query
        if not any(h in query.lower() for h in _LOCATION_HINTS):
            contextual_query = f"{query}, Champaign, IL"

        try:
            async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": GEOCODE_USER_AGENT}) as client:
                r = await client.get(
                    NOMINATIM_URL,
                    params={
                        "q": contextual_query,
                        "format": "json",
                        "limit": 1,
                        "viewbox": NOMINATIM_VIEWBOX,
                        "bounded": "0",
                    },
                )
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            raise RuntimeError(f"Nominatim request failed: {e}") from e

        # Rate-limit: wait 1.05s before releasing the semaphore so next caller is safe
        await asyncio.sleep(1.05)

    if not data:
        raise LookupError(f'No results for "{query[:80]}".')

    first = data[0]
    result = {
        "lat": float(first.get("lat", 0)),
        "lng": float(first.get("lon", 0)),
        "display_name": first.get("display_name", ""),
    }

    # Evict oldest entry if at capacity
    if len(_geocode_cache) >= GEOCODE_CACHE_MAX:
        oldest_key = min(_geocode_cache, key=lambda k: _geocode_cache[k][1])
        _geocode_cache.pop(oldest_key, None)

    _geocode_cache[query] = (result, time.time() + GEOCODE_CACHE_TTL)
    return result


async def _nominatim_quick(query: str, limit: int = 3) -> list[dict]:
    """Nominatim search for autocomplete — short timeout, no rate-limit semaphore."""
    import httpx
    contextual = query if any(h in query.lower() for h in _LOCATION_HINTS) else f"{query}, Champaign, IL"
    try:
        async with httpx.AsyncClient(timeout=3.0, headers={"User-Agent": GEOCODE_USER_AGENT}) as client:
            r = await client.get(
                NOMINATIM_URL,
                params={"q": contextual, "format": "json", "limit": limit,
                        "viewbox": NOMINATIM_VIEWBOX, "bounded": "1"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return []
    results = []
    for item in data[:limit]:
        display = item.get("display_name", "")
        short_name = display.split(",")[0].strip()
        results.append({
            "type": "place",
            "name": short_name,
            "display_name": display,
            "lat": float(item.get("lat", 0)),
            "lng": float(item.get("lon", 0)),
        })
    return results


@app.get("/autocomplete")
async def autocomplete(request: Request, q: str = "", limit: int = 8):
    """
    Combined autocomplete: local buildings (instant) + Nominatim places.
    Returns { results: [{type, name, display_name?, lat, lng, building_id?}] }.
    Buildings shown first; Nominatim backfills when few building matches.
    """
    query = (q or "").strip()
    if not query or len(query) < 2:
        return {"results": []}
    results: list[dict] = []
    seen_names: set[str] = set()
    buildings = search_buildings(APP_DB, query, limit=min(5, limit))
    for b in buildings:
        key = b.name.lower()
        if key not in seen_names:
            seen_names.add(key)
            results.append({"type": "building", "name": b.name, "lat": b.lat, "lng": b.lng, "building_id": b.building_id})
    # Fetch Nominatim suggestions if fewer than 3 building matches
    if len(results) < 3:
        nom = await _nominatim_quick(query, limit=max(1, limit - len(results)))
        for item in nom:
            if item["name"].lower() not in seen_names:
                seen_names.add(item["name"].lower())
                results.append(item)
    return {"results": results[:limit]}


@app.get("/geocode")
async def geocode(request: Request, q: str = ""):
    """
    Resolve a place name or address to coordinates (uses OpenStreetMap Nominatim).
    Results cached for 24h; Nominatim rate-limited to 1 req/sec.
    Returns first result as { lat, lng, display_name } or 404 if none.
    """
    query = (q or "").strip()
    if not query or len(query) < 2:
        raise HTTPException(status_code=400, detail="Provide a search query (e.g. McDonald's Champaign, or an address).")
    try:
        result = await _nominatim_lookup(query)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        logger.warning("telemetry geocode_error q=%s error=%s", query[:50], str(e))
        raise HTTPException(status_code=502, detail="Geocoding service unavailable. Try again.") from e
    return result


@app.get("/stops/nearby", response_model=NearbyStopsResponse)
def stops_nearby(request: Request, lat: float = 0.0, lng: float = 0.0, radius_m: int = 800):
    _validate_lat_lng(lat, lng)
    if not (RADIUS_M_MIN <= radius_m <= RADIUS_M_MAX):
        raise HTTPException(
            status_code=400,
            detail=f"radius_m must be between {RADIUS_M_MIN} and {RADIUS_M_MAX}",
        )
    logger.info("telemetry route=stops_nearby radius_m=%s", radius_m)
    stops = search_nearby(STOPS_DB, lat, lng, radius_m, limit=10)
    return NearbyStopsResponse(
        stops=[StopInfo(stop_id=s.stop_id, stop_name=s.stop_name, lat=s.lat, lng=s.lng) for s in stops]
    )


@app.get("/stops/{stop_id}/departures", response_model=DeparturesResponse)
def get_departures(request: Request, stop_id: str, minutes: int = 60):
    if not stop_id or len(stop_id) > STOP_ID_MAX_LEN or not STOP_ID_PATTERN.match(stop_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid stop_id (alphanumeric, underscore, hyphen only; max 64 chars).",
        )
    if not (DEPARTURES_MINUTES_MIN <= minutes <= DEPARTURES_MINUTES_MAX):
        raise HTTPException(
            status_code=400,
            detail=f"minutes must be between {DEPARTURES_MINUTES_MIN} and {DEPARTURES_MINUTES_MAX}",
        )
    logger.info("telemetry route=departures stop_id=%s minutes=%s", stop_id, minutes)
    client: MTDClient | None = getattr(app.state, "mtd_client", None)
    if not client:
        raise HTTPException(
            status_code=503,
            detail="MTD API key not configured. Set MTD_API_KEY in the environment.",
        )
    try:
        data = client.get_departures_by_stop(stop_id=stop_id, minutes=minutes)
        return DeparturesResponse(**data)
    except RuntimeError as e:
        logger.warning("telemetry departures_route_error stop_id=%s error=%s", stop_id, str(e))
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:
        logger.warning("telemetry departures_route_error stop_id=%s error=%s", stop_id, str(e))
        raise HTTPException(
            status_code=502,
            detail="Failed to fetch departures from transit API. Please try again.",
        ) from e


# --- Live vehicle positions ---


@app.get("/vehicles")
def get_vehicles(request: Request, route_id: str = ""):
    """Return vehicles currently in service. Optional ?route_id= filter. 10s TTL cache."""
    logger.info("telemetry route=vehicles route_id=%s", route_id or "all")
    client: MTDClient | None = getattr(app.state, "mtd_client", None)
    if not client:
        raise HTTPException(
            status_code=503,
            detail="MTD API key not configured. Set MTD_API_KEY in the environment.",
        )
    try:
        vehicles = client.get_vehicles_in_service(route_id=route_id or None)
        return {"vehicles": vehicles}
    except Exception as e:
        logger.warning("telemetry vehicles_error error=%s", str(e))
        raise HTTPException(status_code=502, detail="Failed to fetch vehicle positions.") from e


# --- Buildings & Schedule (MVP: default user only) ---


@app.get("/buildings", response_model=BuildingsListResponse)
def get_buildings(request: Request):
    """List all buildings. Seed data with scripts/seed_buildings.py first."""
    buildings = list_buildings(APP_DB)
    return BuildingsListResponse(
        buildings=[
            BuildingResponse(building_id=b.building_id, name=b.name, lat=b.lat, lng=b.lng)
            for b in buildings
        ]
    )


@app.get("/buildings/search", response_model=BuildingsListResponse)
def search_buildings_endpoint(request: Request, q: str = "", limit: int = 6):
    """Search buildings by name (case-insensitive contains). Returns up to `limit` results ranked by relevance."""
    query = (q or "").strip()
    if not query or len(query) < 2:
        return BuildingsListResponse(buildings=[])
    if not (1 <= limit <= 20):
        limit = 6
    results = search_buildings(APP_DB, query, limit=limit)
    return BuildingsListResponse(
        buildings=[
            BuildingResponse(building_id=b.building_id, name=b.name, lat=b.lat, lng=b.lng)
            for b in results
        ]
    )


@app.post("/schedule/classes", response_model=ClassResponse, status_code=201)
def post_schedule_class(request: Request, body: CreateClassRequest):
    """Create a class for the default user. Use building_id or destination_lat/lng/name (from address search)."""
    try:
        rec = create_class(
            APP_DB,
            title=body.title,
            days_of_week=body.days_of_week,
            start_time_local=body.start_time_local,
            building_id=body.building_id,
            destination_lat=body.destination_lat,
            destination_lng=body.destination_lng,
            destination_name=body.destination_name,
            end_time_local=body.end_time_local,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ClassResponse(
        class_id=rec.class_id,
        title=rec.title,
        days_of_week=rec.days_of_week,
        start_time_local=rec.start_time_local,
        building_id=rec.building_id,
        destination_lat=rec.destination_lat,
        destination_lng=rec.destination_lng,
        destination_name=rec.destination_name,
        end_time_local=rec.end_time_local,
    )


@app.delete("/schedule/classes/{class_id}", status_code=204)
def delete_schedule_class(request: Request, class_id: str):
    """Delete a class for the default user."""
    deleted = delete_class(APP_DB, class_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Class not found.")


@app.get("/schedule/classes", response_model=ClassesListResponse)
def get_schedule_classes(request: Request):
    """List classes for the default user."""
    classes = list_classes(APP_DB)
    return ClassesListResponse(
        classes=[
            ClassResponse(
                class_id=c.class_id,
                title=c.title,
                days_of_week=c.days_of_week,
                start_time_local=c.start_time_local,
                building_id=c.building_id,
                destination_lat=c.destination_lat,
                destination_lng=c.destination_lng,
                destination_name=c.destination_name,
                end_time_local=c.end_time_local,
            )
            for c in classes
        ]
    )


# --- Recommendation (user location -> destination building) ---


def _get_building_for_recommendation(building_id: str) -> tuple[float, float, str] | None:
    from src.data.buildings_repo import get_building
    b = get_building(APP_DB, building_id)
    if b is None:
        return None
    return (b.lat, b.lng, b.name)


def _search_nearby_for_recommendation(lat: float, lng: float, radius_m: float, limit: int) -> list[tuple[str, str, float, float]]:
    stops = search_nearby(STOPS_DB, lat, lng, radius_m, limit=limit)
    return [(s.stop_id, s.stop_name, s.lat, s.lng) for s in stops]


def _get_departures_for_recommendation(stop_id: str) -> list[dict]:
    client: MTDClient | None = getattr(app.state, "mtd_client", None)
    if not client:
        return []
    try:
        data = client.get_departures_by_stop(stop_id=stop_id, minutes=60)
        return data.get("departures") or []
    except Exception:
        return []


@app.post("/recommendation", response_model=RecommendationResponse)
def post_recommendation(request: Request, body: RecommendationRequest):
    """Return 2–3 options (WALK + BUS) from user location to destination (building or custom lat/lng)."""
    if body.destination_lat is not None and body.destination_lng is not None:
        dest_lat, dest_lng = body.destination_lat, body.destination_lng
        dest_name = body.destination_name or "Destination"
        destination_building_id = "custom"
        logger.info("telemetry route=recommendation custom_destination lat=%s lng=%s", dest_lat, dest_lng)
    elif body.destination_building_id:
        building = _get_building_for_recommendation(body.destination_building_id)
        if building is None:
            raise HTTPException(
                status_code=400,
                detail=f"Building not found: {body.destination_building_id}.",
            )
        dest_lat, dest_lng, dest_name = building
        destination_building_id = body.destination_building_id
        logger.info("telemetry route=recommendation building_id=%s", destination_building_id)
    else:
        raise HTTPException(status_code=400, detail="Provide destination_building_id or destination_lat and destination_lng.")
    try:
        options = compute_recommendations(
            lat=body.lat,
            lng=body.lng,
            destination_building_id=destination_building_id,
            destination_lat=dest_lat,
            destination_lng=dest_lng,
            destination_name=dest_name,
            arrive_by_iso=body.arrive_by_iso,
            walking_speed_mps=body.walking_speed_mps,
            buffer_minutes=body.buffer_minutes,
            max_options=body.max_options,
            now=None,
            get_building=_get_building_for_recommendation,
            search_nearby_stops=_search_nearby_for_recommendation,
            get_departures=_get_departures_for_recommendation,
        )
    except ValueError as e:
        if "invalid_arrive_by" in str(e):
            raise HTTPException(
                status_code=400,
                detail="Invalid arrive_by_iso. Use ISO 8601 (e.g. 2026-02-22T15:00:00Z).",
            ) from e
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("telemetry recommendation_error")
        raise HTTPException(
            status_code=503,
            detail="Route computation failed. Please try again in a moment.",
        ) from e
    option_objects = [RecommendationOption(**o) for o in options]

    # AI ranking: if Claude key configured, rank and annotate options
    claude_key = getattr(settings, "claude_api_key", "")
    if claude_key and option_objects:
        try:
            from src.ai.claude_client import ClaudeClient
            ai_client = ClaudeClient(api_key=claude_key)
            route_opts_for_ai = [
                {"type": o.type, "eta_minutes": o.eta_minutes, "depart_in_minutes": o.depart_in_minutes, "summary": o.summary}
                for o in option_objects
            ]
            ai_result = ai_client.get_best_route(
                origin=f"{body.lat},{body.lng}",
                destination=dest_name,
                route_options=route_opts_for_ai,
                user_context={},
            )
            ranked_order = ai_result.get("ranked_order", [])
            ai_explanation = ai_result.get("ai_explanation", "")
            if ranked_order and len(ranked_order) == len(option_objects):
                option_objects = [option_objects[i] for i in ranked_order if i < len(option_objects)]
            if ai_explanation and option_objects:
                option_objects[0] = option_objects[0].model_copy(
                    update={"ai_explanation": ai_explanation, "ai_ranked": True}
                )
        except Exception:
            pass  # AI ranking failure is non-fatal

    return RecommendationResponse(options=option_objects)


# --- Walking directions proxy ---

# Cache: (rounded orig/dest) → (result, expires_at)
_walk_directions_cache: dict[str, tuple[dict, float]] = {}
WALK_DIRECTIONS_CACHE_TTL = 300  # 5 minutes


@app.get("/directions/walk")
async def directions_walk(request: Request, orig_lat: float, orig_lng: float, dest_lat: float, dest_lng: float):
    """Proxy walking directions via OSRM. Returns { coords: [[lat, lng], ...] }."""
    import httpx

    def _round5(v: float) -> float:
        return round(v, 5)

    cache_key = f"{_round5(orig_lat)},{_round5(orig_lng)}-{_round5(dest_lat)},{_round5(dest_lng)}"
    now = time.time()
    if cache_key in _walk_directions_cache:
        result, expires_at = _walk_directions_cache[cache_key]
        if now < expires_at:
            return result

    fallback = {"coords": [[orig_lat, orig_lng], [dest_lat, dest_lng]]}
    try:
        osrm_url = (
            f"http://router.project-osrm.org/route/v1/foot/"
            f"{orig_lng},{orig_lat};{dest_lng},{dest_lat}"
            f"?geometries=geojson&overview=full"
        )
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(osrm_url)
            r.raise_for_status()
            data = r.json()
        coordinates = data["routes"][0]["geometry"]["coordinates"]  # [[lng, lat], ...]
        coords = [[c[1], c[0]] for c in coordinates]  # reorder to [lat, lng]
        result = {"coords": coords}
    except Exception as e:
        logger.warning("telemetry osrm_error error=%s", str(e))
        result = fallback

    _walk_directions_cache[cache_key] = (result, now + WALK_DIRECTIONS_CACHE_TTL)
    return result


# --- GTFS bus shape + stops ---


@app.get("/gtfs/route-stops")
def gtfs_route_stops(request: Request, route_id: str = "", from_stop_id: str = "", to_stop_id: str = "", after_time: str = ""):
    """Return bus trip shape and stops between two stops. Gracefully returns empty if GTFS DB missing."""
    from src.data.gtfs_repo import find_connecting_trips, get_shape_for_trip, get_stops_for_trip_between

    empty = {"trip_id": None, "stops": [], "shape_points": []}
    if not from_stop_id or not to_stop_id:
        return empty
    try:
        trips = find_connecting_trips(GTFS_DB, from_stop_id, to_stop_id, after_time or "00:00:00")
        if not trips:
            return empty
        trip = trips[0]
        trip_id = trip["trip_id"]
        stops = get_stops_for_trip_between(GTFS_DB, trip_id, from_stop_id, to_stop_id)
        shape = get_shape_for_trip(GTFS_DB, trip_id)
        return {
            "trip_id": trip_id,
            "stops": stops,
            "shape_points": [[lat, lng] for lat, lng in shape],
        }
    except Exception as e:
        logger.warning("telemetry gtfs_route_stops_error error=%s", str(e))
        return empty


# --- AI endpoints ---

from pydantic import BaseModel as _BaseModel


class AfterClassPlanRequest(_BaseModel):
    freetext_plan: str = ""
    lat: float = 0.0
    lng: float = 0.0


class EodReportRequest(_BaseModel):
    entries: list[dict] = []
    total_steps: int = 0
    total_calories: float = 0.0
    total_distance_m: float = 0.0


class WalkCompleteRequest(_BaseModel):
    mode: str = "walk"
    distance_m: float = 0.0
    calories: float = 0.0
    dest_name: str = ""


@app.post("/ai/after-class-plan")
def post_after_class_plan(request: Request, body: AfterClassPlanRequest):
    """Return a chained trip plan for after the last class. Phase 2: heuristic; Phase 3: Claude."""
    from src.ai.planner import heuristic_after_class_plan
    if not body.freetext_plan.strip():
        raise HTTPException(status_code=400, detail="Provide freetext_plan.")
    try:
        # Try Claude if configured
        claude_key = getattr(settings, "claude_api_key", "")
        if claude_key:
            from src.ai.claude_client import ClaudeClient
            client = ClaudeClient(api_key=claude_key)
            result = client.get_after_class_plan(
                freetext_plan=body.freetext_plan,
                completed_classes=[],
                available_routes=[],
                activity_today=[],
            )
            return result
    except Exception:
        pass
    return heuristic_after_class_plan(body.freetext_plan, body.lat, body.lng)


@app.post("/ai/eod-report")
def post_eod_report(request: Request, body: EodReportRequest):
    """Return an AI end-of-day activity report. Requires CLAUDE_API_KEY."""
    claude_key = getattr(settings, "claude_api_key", "")
    if not claude_key:
        return {
            "report": (
                f"Today you walked {body.total_distance_m:.0f} m, burned "
                f"{body.total_calories:.0f} kcal, and took {body.total_steps} steps. "
                "Set CLAUDE_API_KEY to get a personalized AI narrative!"
            )
        }
    try:
        from src.ai.claude_client import ClaudeClient
        client = ClaudeClient(api_key=claude_key)
        result = client.get_eod_activity_report(
            activity_entries=body.entries,
            walking_mode="mixed",
            total_stats={
                "steps": body.total_steps,
                "calories": body.total_calories,
                "distance_m": body.total_distance_m,
            },
        )
        return result
    except Exception as e:
        logger.warning("telemetry eod_report_error error=%s", str(e))
        raise HTTPException(status_code=502, detail="Failed to generate AI report.") from e


@app.post("/ai/walk-complete")
def post_walk_complete(request: Request, body: WalkCompleteRequest):
    """Return a short encouragement message after completing a walk."""
    claude_key = getattr(settings, "claude_api_key", "")
    if not claude_key:
        return {"encouragement": f"Great job walking to {body.dest_name}! Keep it up!"}
    try:
        from src.ai.encouragement import get_walk_encouragement
        msg = get_walk_encouragement(
            mode=body.mode,
            distance_m=body.distance_m,
            calories=body.calories,
            dest_name=body.dest_name,
        )
        return {"encouragement": msg}
    except Exception as e:
        logger.warning("telemetry walk_complete_error error=%s", str(e))
        return {"encouragement": f"Great job walking to {body.dest_name}!"}
