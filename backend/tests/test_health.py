"""Tests for the liveness (/health) and readiness (/health/ready) probes."""
from unittest.mock import AsyncMock, MagicMock, patch

from starlette.testclient import TestClient

import main


def test_health_liveness_ok():
    client = TestClient(main.app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_ready_returns_200_when_db_reachable():
    mock_pool = MagicMock()
    mock_pool.fetchval = AsyncMock(return_value=1)
    with patch("main.get_pool", return_value=mock_pool):
        client = TestClient(main.app)
        r = client.get("/health/ready")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"


def test_health_ready_returns_503_when_pool_uninitialized():
    with patch("main.get_pool", side_effect=RuntimeError("Database pool not initialized")):
        client = TestClient(main.app)
        r = client.get("/health/ready")
    assert r.status_code == 503


def test_health_ready_returns_503_when_query_fails():
    mock_pool = MagicMock()
    mock_pool.fetchval = AsyncMock(side_effect=Exception("connection refused"))
    with patch("main.get_pool", return_value=mock_pool):
        client = TestClient(main.app)
        r = client.get("/health/ready")
    assert r.status_code == 503
