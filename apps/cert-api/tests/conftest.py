"""Pytest fixtures for cert-api tests."""

import sys
from types import ModuleType
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient


def _make_stub_module(name: str) -> ModuleType:
    """Create a stub module so imports don't fail when native libs are absent."""
    mod = ModuleType(name)
    sys.modules[name] = mod
    return mod


# Stub oracledb and pymssql if not installed (they require native libs unavailable in CI)
if "oracledb" not in sys.modules:
    _oracledb = _make_stub_module("oracledb")
    _oracledb.connect = MagicMock()  # type: ignore[attr-defined]
    _oracledb.makedsn = MagicMock(return_value="mock_dsn")  # type: ignore[attr-defined]
    _oracledb.init_oracle_client = MagicMock()  # type: ignore[attr-defined]

if "pymssql" not in sys.modules:
    _pymssql = _make_stub_module("pymssql")
    _pymssql.connect = MagicMock()  # type: ignore[attr-defined]


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

    import oracledb
    mocker.patch.object(oracledb, "connect", return_value=mock_conn)
    mocker.patch.object(oracledb, "makedsn", return_value="mock_dsn")
    mocker.patch.object(oracledb, "init_oracle_client")
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

    import pymssql
    mocker.patch.object(pymssql, "connect", return_value=mock_conn)
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

    Startup hooks are patched to prevent actual DB/scheduler initialization.
    Module-level DATABASE_URL constants are patched to empty string so routes
    return early without hitting psycopg2.

    Yields:
        httpx.AsyncClient configured for the FastAPI app.
    """
    import os
    os.environ["CERT_API_KEY"] = "test-key"
    os.environ["DATABASE_URL"] = ""

    # Patch startup side-effects
    mocker.patch("app.db.postgres.ensure_tables", return_value=None)
    mocker.patch("app.routes.schedules.scheduler.start")
    mocker.patch("app.routes.schedules.load_schedules_into_scheduler")

    # Patch the cached DATABASE_URL constants in all route modules
    # (they're imported at module load time so env changes don't propagate)
    for mod in (
        "app.routes.certifications",
        "app.routes.stock",
        "app.routes.reports",
        "app.routes.schedules",
        "app.routes.health",
    ):
        mocker.patch(f"{mod}.DATABASE_URL", "")

    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
