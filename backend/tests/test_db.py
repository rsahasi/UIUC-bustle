import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from src.data.db import init_pool, close_pool, get_pool


@pytest.mark.asyncio
async def test_get_pool_raises_before_init():
    """get_pool() raises RuntimeError before init_pool() is called."""
    import src.data.db as db_module
    db_module._pool = None
    with pytest.raises(RuntimeError, match="not initialized"):
        get_pool()


@pytest.mark.asyncio
async def test_init_and_get_pool():
    """After init_pool(), get_pool() returns the pool."""
    mock_pool = MagicMock()
    with patch("asyncpg.create_pool", new=AsyncMock(return_value=mock_pool)):
        await init_pool("postgresql://test")
        assert get_pool() is mock_pool


@pytest.mark.asyncio
async def test_close_pool_clears_pool():
    """close_pool() closes the pool and resets _pool to None."""
    import src.data.db as db_module
    mock_pool = AsyncMock()
    db_module._pool = mock_pool
    await close_pool()
    mock_pool.close.assert_awaited_once()
    assert db_module._pool is None


@pytest.mark.asyncio
async def test_close_pool_noop_when_not_initialized():
    """close_pool() does nothing if pool was never initialized."""
    import src.data.db as db_module
    db_module._pool = None
    await close_pool()  # Should not raise
