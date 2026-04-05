"""Tests for route authentication and basic contract."""

import pytest


@pytest.mark.asyncio
async def test_auth_required_for_stats(test_client):
    """GET /api/stats without X-API-Key should return 403 when key is configured."""
    resp = await test_client.get("/api/stats")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_invalid_api_key_rejected(test_client):
    """Invalid API key should be rejected with 403."""
    resp = await test_client.get("/api/stats", headers={"X-API-Key": "wrong-key"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_valid_api_key_accepted(test_client, api_key_headers):
    """Valid API key should be accepted (stats returns 200 even with no DB)."""
    resp = await test_client.get("/api/stats", headers=api_key_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_stats_response_shape(test_client, api_key_headers):
    """Stats response should have the expected keys."""
    resp = await test_client.get("/api/stats", headers=api_key_headers)
    data = resp.json()
    assert "total_products" in data
    assert "total_expired" in data
    assert "by_brand" in data


@pytest.mark.asyncio
async def test_products_list_response_shape(test_client, api_key_headers):
    """Products list should return paginated shape."""
    resp = await test_client.get("/api/products", headers=api_key_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "products" in data
    assert "total" in data
    assert "page" in data


@pytest.mark.asyncio
async def test_reports_list_returns_list(test_client, api_key_headers):
    """Reports list endpoint should return a list."""
    resp = await test_client.get("/api/reports", headers=api_key_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_report_path_traversal_blocked(test_client, api_key_headers):
    """Path traversal filenames must be rejected."""
    resp = await test_client.get("/api/reports/../etc/passwd", headers=api_key_headers)
    assert resp.status_code in (400, 404)


@pytest.mark.asyncio
async def test_schedules_returns_list(test_client, api_key_headers):
    """Schedules endpoint should return a list (empty without DB)."""
    resp = await test_client.get("/api/schedules", headers=api_key_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
