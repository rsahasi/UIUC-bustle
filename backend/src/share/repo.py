"""SQLite CRUD for shared_trips table."""
from __future__ import annotations

import secrets
import time
from pathlib import Path
from typing import Optional
import sqlite3

HARD_CAP_SECONDS = 7200        # 2 hours
LAZY_DELETE_GRACE = 86400      # delete rows 24h past expiry on next read


def create_shared_trip(
    db_path: str | Path,
    destination: str,
    route_id: Optional[str],
    route_name: Optional[str],
    stop_name: Optional[str],
    phase: str,
    eta_epoch: Optional[int],
) -> str:
    """Insert a new shared trip. Returns the token. Retries once on collision."""
    now = int(time.time())
    expires_at = now + HARD_CAP_SECONDS
    for _ in range(2):
        token = secrets.token_urlsafe(6)[:8]
        try:
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """INSERT INTO shared_trips
                       (id, destination, route_id, route_name, stop_name, phase, eta_epoch, created_at, expires_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (token, destination, route_id, route_name, stop_name, phase, eta_epoch, now, expires_at),
                )
                conn.commit()
            return token
        except sqlite3.IntegrityError:
            continue  # collision — retry with new token
    raise RuntimeError("Failed to generate unique share token after 2 attempts")


def patch_shared_trip(
    db_path: str | Path,
    token: str,
    phase: Optional[str],
    eta_epoch: Optional[int],
) -> bool:
    """Update phase/eta. Returns False if not found or expired."""
    now = int(time.time())
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT expires_at FROM shared_trips WHERE id = ?", (token,)
        ).fetchone()
        if row is None or row[0] <= now:
            return False
        updates: list[str] = []
        params: list = []
        if phase is not None:
            updates.append("phase = ?")
            params.append(phase)
            if phase == "arrived":
                updates.append("expires_at = ?")
                params.append(now)
        if eta_epoch is not None:
            updates.append("eta_epoch = ?")
            params.append(eta_epoch)
        if not updates:
            return True
        params.append(token)
        conn.execute(f"UPDATE shared_trips SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    return True


def get_shared_trip_status(
    db_path: str | Path,
    token: str,
) -> dict | None:
    """Return trip status dict, or None if not found. Lazy-deletes rows 24h past expiry."""
    now = int(time.time())
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            """SELECT destination, route_id, route_name, stop_name, phase, eta_epoch, expires_at
               FROM shared_trips WHERE id = ?""",
            (token,),
        ).fetchone()
        if row is None:
            return None
        destination, route_id, route_name, stop_name, phase, eta_epoch, expires_at = row
        # Lazy cleanup: delete if 24h past expiry
        if expires_at < now - LAZY_DELETE_GRACE:
            conn.execute("DELETE FROM shared_trips WHERE id = ?", (token,))
            conn.commit()
            return None
        expired = expires_at <= now
        return {
            "destination": destination,
            "route_id": route_id,
            "route_name": route_name,
            "stop_name": stop_name,
            "phase": phase,
            "eta_epoch": eta_epoch,
            "expired": expired,
        }
