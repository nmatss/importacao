"""Pytest fixtures for cert-api tests."""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def api_key_headers() -> dict:
    """Headers dict with a test API key.

    Returns:
        Dict with X-API-Key header set to 'test-key'.
    """
    return {"X-API-Key": "test-key"}


@pytest.fixture
def mock_oracle_conn(mocker):
    """Mock oracledb connection and cursor.

    Returns:
        Mock cursor object with fetchall returning empty list by default.
    """
    mock_cursor = mocker.MagicMock()
    mock_cursor.description = []
    mock_cursor.fetchall.return_value = []

    mock_conn = mocker.MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_conn.__enter__ = mocker.MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = mocker.MagicMock(return_value=False)

    mocker.patch("oracledb.connect", return_value=mock_conn)
    mocker.patch("oracledb.makedsn", return_value="mock_dsn")
    mocker.patch("oracledb.init_oracle_client")
    return mock_cursor


@pytest.fixture
def mock_sqlserver_conn(mocker):
    """Mock pymssql connection and cursor.

    Returns:
        Mock cursor object with fetchall returning empty list by default.
    """
    mock_cursor = mocker.MagicMock()
    mock_cursor.fetchall.return_value = []

    mock_conn = mocker.MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_conn.__enter__ = mocker.MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = mocker.MagicMock(return_value=False)

    mocker.patch("pymssql.connect", return_value=mock_conn)
    return mock_cursor


@pytest.fixture
def mock_db(mocker):
    """Mock the db() context manager to avoid real DB connections.

    Returns:
        Tuple of (mock_conn, mock_cursor).
    """
    mock_cursor = mocker.MagicMock()
    mock_cursor.fetchone.return_value = None
    mock_cursor.fetchall.return_value = []
    mock_cursor.rowcount = 1

    mock_conn = mocker.MagicMock()

    mock_ctx = mocker.MagicMock()
    mock_ctx.__enter__ = mocker.MagicMock(return_value=(mock_conn, mock_cursor))
    mock_ctx.__exit__ = mocker.MagicMock(return_value=False)

    mocker.patch("app.db.postgres.db", return_value=mock_ctx)
    return mock_conn, mock_cursor


@pytest.fixture
async def test_client(mocker):
    """AsyncClient pointed at the FastAPI app with DB mocked out.

    Yields:
        httpx.AsyncClient configured for the FastAPI app.
    """
    import os
    os.environ.setdefault("CERT_API_KEY", "test-key")
    os.environ.setdefault("DATABASE_URL", "")

    # Prevent actual DB/scheduler startup
    mocker.patch("app.main.ensure_tables", return_value=None)
    mocker.patch("app.routes.schedules.scheduler.start")
    mocker.patch("app.routes.schedules.load_schedules_into_scheduler")

    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
