"""Request logging middleware: log method, path, status_code, duration_ms, client_ip for every request."""
import ipaddress
import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from src.monitoring.metrics import record_request

logger = logging.getLogger(__name__)


def _anonymize_ip(ip: str) -> str:
    """Return a privacy-safe version of an IP address.
    IPv4: zero the last octet (e.g. 1.2.3.4 → 1.2.3.0).
    IPv6: mask to the /48 network prefix (e.g. 2001:db8:1::1 → 2001:db8:1::).
    """
    if not ip:
        return ""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 4:
        network = ipaddress.ip_network(f"{ip}/24", strict=False)
    else:
        network = ipaddress.ip_network(f"{ip}/48", strict=False)
    return str(network.network_address)


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
