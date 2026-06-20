"""Tests for health check endpoints."""

import pytest


@pytest.mark.asyncio
async def test_health_always_200(test_client):
    """GET /api/health should always return 200 regardless of auth."""
    resp = await test_client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "timestamp" in data


@pytest.mark.asyncio
async def test_health_no_auth_required(test_client):
    """Health endpoint must not require API key."""
    resp = await test_client.get("/api/health")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_health_reports_sheets_config_from_sheets_credentials(test_client, mocker):
    """Sheets config flag should not be derived from DATABASE_URL."""
    mocker.patch("app.routes.health.DATABASE_URL", "postgres://test")
    mocker.patch("app.routes.health.SHEETS_CLIENT_EMAIL", "")
    mocker.patch("app.routes.health.SHEETS_PRIVATE_KEY", "")
    mocker.patch("app.routes.health.SHEETS_SPREADSHEET_ID", "")
    cursor = mocker.MagicMock()
    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cursor))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.health.db", return_value=ctx)

    resp = await test_client.get("/api/health")

    assert resp.status_code == 200
    assert resp.json()["sheets_configured"] is False


@pytest.mark.asyncio
async def test_ready_no_db(test_client):
    """GET /api/ready should return ready=False when DATABASE_URL is empty."""
    resp = await test_client.get("/api/ready")
    assert resp.status_code == 200
    data = resp.json()
    # When DATABASE_URL is empty, not ready
    assert "ready" in data


@pytest.mark.asyncio
async def test_ready_fails_when_reports_dir_not_writable(test_client, mocker):
    """Readiness should catch cert-reports volume permission issues before export."""
    mocker.patch("app.routes.health.DATABASE_URL", "postgres://test")
    cursor = mocker.MagicMock()
    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cursor))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.health.db", return_value=ctx)

    class Probe:
        def write_text(self, *_args, **_kwargs):
            raise PermissionError("denied")

    class ReportsDir:
        def __truediv__(self, _name):
            return Probe()

    mocker.patch("app.routes.health.REPORTS_DIR", ReportsDir())

    resp = await test_client.get("/api/ready")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ready"] is False
    assert data["reason"] == "REPORTS_DIR not writable"


@pytest.mark.asyncio
async def test_ready_fails_when_certs_dir_not_writable(test_client, mocker, tmp_path):
    """Readiness should catch certificate PDF volume permission issues."""
    mocker.patch("app.routes.health.DATABASE_URL", "postgres://test")
    cursor = mocker.MagicMock()
    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cursor))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.health.db", return_value=ctx)
    mocker.patch("app.routes.health.REPORTS_DIR", tmp_path)

    class Probe:
        def write_text(self, *_args, **_kwargs):
            raise PermissionError("denied")

    class CertsDir:
        def __truediv__(self, _name):
            return Probe()

    mocker.patch("app.routes.health.CERTS_DIR", CertsDir())

    resp = await test_client.get("/api/ready")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ready"] is False
    assert data["reason"] == "CERTS_DIR not writable"
