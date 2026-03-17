"""Request logging middleware: log method, path, status_code, duration_ms, client_ip for every request."""
import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from src.monitoring.metrics import record_request

logger = logging.getLogger(__name__)


def _anonymize_ip(ip: str) -> str:
    """Return a privacy-safe version of an IP address.
    IPv4: zero the last octet (e.g. 1.2.3.4 → 1.2.3.0).
    IPv6: keep only the first 3 groups (e.g. 2001:db8:1::1 → 2001:db8:1::).
    """
    if not ip:
        return ""
    if ":" in ip:
        parts = ip.split(":")
        return ":".join(parts[:3]) + "::"
    parts = ip.split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.{parts[2]}.0"
    return ip


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    raw = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    return _anonymize_ip(raw)


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
