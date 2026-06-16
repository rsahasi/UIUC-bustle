"""Pytest configuration and fixtures."""
import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio

# Ensure backend root is on path when running pytest from repo root or backend
backend = Path(__file__).resolve().parent.parent
if str(backend) not in sys.path:
    sys.path.insert(0, str(backend))


# Postgres connection for DB-backed tests. Prefer TEST_DATABASE_URL, fall back to
# DATABASE_URL, then a local default. The schema must already be migrated
# (`alembic upgrade head`); tests that need it skip cleanly if Postgres is absent.
TEST_DATABASE_URL = (
    os.environ.get("TEST_DATABASE_URL")
    or os.environ.get("DATABASE_URL")
    or "postgresql://localhost:5432/uiuc_test"
)


@pytest_asyncio.fixture
async def pg_pool():
    """An asyncpg pool against the test Postgres, with the per-test tables emptied.

    Skips (rather than fails) when Postgres isn't reachable or isn't migrated, so
    the rest of the suite still runs in environments without a database.
    """
    import asyncpg

    try:
        pool = await asyncpg.create_pool(TEST_DATABASE_URL, min_size=1, max_size=4)
    except Exception as e:  # noqa: BLE001 - any connection failure → skip
        pytest.skip(f"Postgres not available at {TEST_DATABASE_URL}: {e}")
        return

    try:
        await pool.execute("TRUNCATE crowding_reports, shared_trips")
    except Exception as e:  # noqa: BLE001 - tables missing → schema not migrated
        await pool.close()
        pytest.skip(f"Schema not migrated ({e}); run `alembic upgrade head`")
        return

    try:
        yield pool
    finally:
        await pool.close()
