"""In-memory request metrics for /metrics endpoint (production: replace with Prometheus or similar)."""
import time
from collections.abc import MutableMapping
from threading import Lock

_start_time = time.monotonic()
_counts: MutableMapping[str, int] = {}
_lock = Lock()


def record_request(status_code: int) -> None:
    if 200 <= status_code < 300:
        bucket = "2xx"
    elif 400 <= status_code < 500:
        bucket = "4xx"
    elif status_code >= 500:
        bucket = "5xx"
    else:
        bucket = "other"
    with _lock:
        _counts[bucket] = _counts.get(bucket, 0) + 1


def get_metrics() -> dict:
    with _lock:
        counts = dict(_counts)
    uptime_seconds = time.monotonic() - _start_time
    return {
        "requests_total": sum(counts.values()),
        "requests_2xx": counts.get("2xx", 0),
        "requests_4xx": counts.get("4xx", 0),
        "requests_5xx": counts.get("5xx", 0),
        "uptime_seconds": round(uptime_seconds, 1),
    }
