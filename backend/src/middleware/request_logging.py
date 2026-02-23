"""Request logging middleware: log method, path, status_code, duration_ms, client_ip for every request."""
import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from src.monitoring.metrics import record_request

logger = logging.getLogger(__name__)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log each request with method, path, status_code, duration_ms, client_ip; record metrics."""

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        client = _client_ip(request)
        record_request(response.status_code)
        logger.info(
            "request method=%s path=%s status=%s duration_ms=%.1f client=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            client,
        )
        return response
