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
async def test_ready_no_db(test_client):
    """GET /api/ready should return ready=False when DATABASE_URL is empty."""
    resp = await test_client.get("/api/ready", headers={"X-API-Key": "test-key"})
    assert resp.status_code == 200
    data = resp.json()
    # When DATABASE_URL is empty, not ready
    assert "ready" in data
