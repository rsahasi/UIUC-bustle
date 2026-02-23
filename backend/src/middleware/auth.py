"""Optional API key auth: when API_KEY_REQUIRED=true, require X-API-Key or Authorization: Bearer <key>."""
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

AUTH_EXEMPT_PATHS = {"/health", "/metrics"}


def get_valid_api_keys(api_keys_str: str) -> set[str]:
    return {k.strip() for k in api_keys_str.split(",") if k.strip()}


def extract_api_key(request: Request) -> str | None:
    # X-API-Key header
    key = request.headers.get("X-API-Key")
    if key:
        return key.strip()
    # Authorization: Bearer <key>
    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


class OptionalAPIKeyMiddleware(BaseHTTPMiddleware):
    """When api_key_required is True, reject requests without a valid API key (except exempt paths)."""

    def __init__(self, app, api_key_required: bool, api_keys: set[str]):
        super().__init__(app)
        self.api_key_required = api_key_required
        self.valid_keys = api_keys

    async def dispatch(self, request: Request, call_next):
        if request.url.path in AUTH_EXEMPT_PATHS:
            return await call_next(request)
        if not self.api_key_required:
            return await call_next(request)
        key = extract_api_key(request)
        if not key or key not in self.valid_keys:
            logger.warning("telemetry auth_failed path=%s", request.url.path)
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing API key. Provide X-API-Key or Authorization: Bearer <key>."},
            )
        return await call_next(request)
