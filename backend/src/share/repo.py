"""Shared-trips CRUD — Postgres via the asyncpg pool.

The shared_trips table is created by Alembic migration 0003, so live trip
links persist across deploys and are visible from any instance.
"""
from __future__ import annotations

import secrets
import time
from typing import Optional

import asyncpg

HARD_CAP_SECONDS = 7200        # 2 hours
LAZY_DELETE_GRACE = 86400      # delete rows 24h past expiry on next read


async def create_shared_trip(
    pool: asyncpg.Pool,
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
        # 16 bytes ≈ 128 bits of entropy, so the token cannot be guessed/enumerated.
        token = secrets.token_urlsafe(16)
        try:
            await pool.execute(
                """INSERT INTO shared_trips
                   (id, destination, route_id, route_name, stop_name, phase, eta_epoch, created_at, expires_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                token, destination, route_id, route_name, stop_name, phase, eta_epoch, now, expires_at,
            )
            return token
        except asyncpg.UniqueViolationError:
            continue  # collision — retry with new token
    raise RuntimeError("Failed to generate unique share token after 2 attempts")


async def patch_shared_trip(
    pool: asyncpg.Pool,
    token: str,
    phase: Optional[str],
    eta_epoch: Optional[int],
) -> bool:
    """Update phase/eta. Returns False if not found or expired."""
    now = int(time.time())
    row = await pool.fetchrow("SELECT expires_at FROM shared_trips WHERE id = $1", token)
    if row is None or row["expires_at"] <= now:
        return False
    updates: list[str] = []
    params: list = []
    n = 1
    if phase is not None:
        updates.append(f"phase = ${n}")
        params.append(phase)
        n += 1
        if phase == "arrived":
            updates.append(f"expires_at = ${n}")
            params.append(now)
            n += 1
    if eta_epoch is not None:
        updates.append(f"eta_epoch = ${n}")
        params.append(eta_epoch)
        n += 1
    if not updates:
        return True
    params.append(token)
    await pool.execute(f"UPDATE shared_trips SET {', '.join(updates)} WHERE id = ${n}", *params)
    return True


async def get_shared_trip_status(
    pool: asyncpg.Pool,
    token: str,
) -> dict | None:
    """Return trip status dict, or None if not found. Lazy-deletes rows 24h past expiry."""
    now = int(time.time())
    row = await pool.fetchrow(
        """SELECT destination, route_id, route_name, stop_name, phase, eta_epoch, expires_at
           FROM shared_trips WHERE id = $1""",
        token,
    )
    if row is None:
        return None
    # Lazy cleanup: delete if 24h past expiry
    if row["expires_at"] < now - LAZY_DELETE_GRACE:
        await pool.execute("DELETE FROM shared_trips WHERE id = $1", token)
        return None
    return {
        "destination": row["destination"],
        "route_id": row["route_id"],
        "route_name": row["route_name"],
        "stop_name": row["stop_name"],
        "phase": row["phase"],
        "eta_epoch": row["eta_epoch"],
        "expired": row["expires_at"] <= now,
    }
