"""Request logging middleware: log method, path, status_code, duration_ms, client_ip for every request."""
import ipaddress
import logging
import re
import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from src.monitoring.metrics import record_request

logger = logging.getLogger(__name__)

# Accept a caller-supplied correlation id only if it is short and safe (prevents
# log injection / unbounded values); otherwise generate one.
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._\-]{1,64}$")

# Share-trip routes carry the capability token in the path itself (/t/<token>,
# /share/trips/<token>, /share/trips/<token>/status). Anyone holding the token
# can read or update the trip, so it must never land in logs or Sentry.
_TOKEN_PATH_RE = re.compile(r"^/(t|share/trips)/[^/]+")


def _resolve_request_id(request: Request) -> str:
    incoming = request.headers.get("X-Request-ID", "")
    if incoming and _SAFE_REQUEST_ID.match(incoming):
        return incoming
    return uuid.uuid4().hex


def _redact_path(path: str) -> str:
    """Replace the share-token segment of a path with <redacted>; other paths pass through."""
    return _TOKEN_PATH_RE.sub(lambda m: f"/{m.group(1)}/<redacted>", path)


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
        request_id = _resolve_request_id(request)
        request.state.request_id = request_id
        start = time.perf_counter()
        client = _client_ip(request)
        path = _redact_path(request.url.path)
        try:
            response = await call_next(request)
        except Exception:
            # Without this, an unhandled handler exception skips record_request
            # entirely and /metrics reports requests_5xx = 0 forever. Re-raise so
            # the app-level exception handler still builds the 500 response.
            duration_ms = (time.perf_counter() - start) * 1000
            record_request(500)
            logger.exception(
                "request id=%s method=%s path=%s status=500 duration_ms=%.1f client=%s",
                request_id, request.method, path, duration_ms, client,
            )
            raise
        duration_ms = (time.perf_counter() - start) * 1000
        record_request(response.status_code)
        # Echo the correlation id so clients/proxies can tie their logs to ours.
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request id=%s method=%s path=%s status=%s duration_ms=%.1f client=%s",
            request_id,
            request.method,
            path,
            response.status_code,
            duration_ms,
            client,
        )
        return response
