"""Tests for route authentication and basic contract."""

import json
from datetime import date

import pytest


def _db_context(mocker, rows=None):
    cursor = mocker.MagicMock()
    cursor.fetchall.return_value = rows or []
    conn = mocker.MagicMock()
    context = mocker.MagicMock()
    context.__enter__.return_value = (conn, cursor)
    context.__exit__.return_value = False
    return context


def test_validation_report_serializes_the_description_actually_compared(mocker, tmp_path):
    """O JSON nao pode chamar o tipo de certificacao de 'Texto Esperado'."""
    from app.routes import certifications

    product = {
        "sku": "ESC001",
        "name": "ESTOJO ESCOLAR",
        "brand": "Puket Escolares",
        "certification_type": "INMETRO ARTIGOS ESCOLARES SISTEMA 5",
        "ecommerce_description": "Produto certificado conforme Portaria 423.",
        "sheet_status": "ATIVO",
        "is_expired": False,
        "sale_deadline_date": None,
    }
    contexts = [
        _db_context(mocker, [product]),
        _db_context(mocker),
        _db_context(mocker),
    ]
    mocker.patch.object(certifications, "DATABASE_URL", "postgres://test")
    mocker.patch.object(certifications, "REPORTS_DIR", tmp_path)
    mocker.patch.object(certifications, "VTEX_REQUEST_DELAY", 0)
    mocker.patch.object(certifications, "db", side_effect=contexts)
    mocker.patch.object(
        certifications,
        "validate_single_product",
        return_value={
            "status": "OK",
            "score": 1.0,
            "url": "https://example.invalid/esc001",
            "actual_cert_text": "Produto certificado conforme Portaria 423.",
            "error": None,
        },
    )
    run_id = "00000000-0000-0000-0000-000000000001"
    certifications._running_validations[run_id] = {
        "status": "running",
        "processed": 0,
        "total": 0,
        "events": [],
    }

    try:
        certifications._run_validation(run_id, None, None)
        report_path = next(tmp_path.glob("validation_*.json"))
        result = json.loads(report_path.read_text(encoding="utf-8"))["products"][0]
    finally:
        certifications._running_validations.pop(run_id, None)

    assert result["certification_type"] == product["certification_type"]
    assert result["expected_cert_text"] == product["ecommerce_description"]
    assert result["expected_cert_text"] != result["certification_type"]


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
@pytest.mark.parametrize("path", [
    "/api/products", "/api/products?cert_status=ATIVO", "/api/expired",
    "/api/expired?cert_status=ATIVO", "/api/products/SYNTHETIC-PROVENANCE",
])
@pytest.mark.parametrize("closure_certificate, sale_status", [
    ("CERT-CURRENT", "BLOQUEADA"), ("INTERNAL-OLD", "LIBERADA"),
])
async def test_product_api_uses_closure_provenance_without_exposing_it(
    test_client, api_key_headers, mocker, path, closure_certificate, sale_status,
):
    from app.routes import certifications

    product = {
        "sku": "SYNTHETIC-PROVENANCE", "brand": "Puket", "situacao": "ATIVO",
        "numero_certificado": "CERT-CURRENT",
        "encerramento_numero_certificado": closure_certificate,
        "sale_deadline_date": date(2026, 1, 1), "is_expired": True,
        "last_validation_status": "OK", "licenciamento_aplicavel": False,
    }
    context = _db_context(mocker, [product])
    cursor = context.__enter__.return_value[1]

    def execute(sql, params=None):
        cursor.fetchone.return_value = (
            dict(product) if "WHERE sku = %s" in sql else {"cnt": 1, "last_date": None}
        )
        cursor.fetchall.return_value = [] if "FROM cert_stock" in sql else [dict(product)]

    cursor.execute.side_effect = execute
    mocker.patch.object(certifications, "db", return_value=context)
    mocker.patch.object(certifications, "DATABASE_URL", "postgres://test")
    mocker.patch.object(certifications, "_safe_license_map", return_value={})
    mocker.patch("app.services.derivation._today_sp", return_value=date(2026, 9, 18))

    response = await test_client.get(path, headers=api_key_headers)

    assert response.status_code == 200
    body = response.json()
    result = body["products"][0] if "products" in body else body
    assert "encerramento_numero_certificado" not in result
    assert result["numero_certificado"] == "CERT-CURRENT"
    assert result["cert_status"] == "ATIVO"
    assert result["status_venda"] == sale_status


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


@pytest.mark.asyncio
async def test_create_schedule_rejects_invalid_cron(test_client, api_key_headers):
    """Invalid cron should return a clear validation error before DB access."""
    resp = await test_client.post(
        "/api/schedules",
        headers=api_key_headers,
        json={"name": "Invalid", "cron": "60 24 * * *", "enabled": True},
    )
    assert resp.status_code == 400
    assert "Expressao cron invalida" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_update_schedule_rejects_invalid_cron(test_client, api_key_headers):
    """Schedule updates should reject invalid cron with a validation error."""
    resp = await test_client.put(
        "/api/schedules/00000000-0000-0000-0000-000000000000",
        headers=api_key_headers,
        json={"cron": "*/0 * * * *"},
    )
    assert resp.status_code == 400
    assert "Expressao cron invalida" in resp.json()["detail"]
