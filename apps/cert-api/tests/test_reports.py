"""Report route and XLSX generation tests."""

from datetime import UTC, datetime

import openpyxl
import pytest

from app.services.report_service import generate_stock_report


def _patch_reports_db(mocker, rows=None):
    cursor = mocker.MagicMock()
    cursor.fetchall.return_value = rows or []
    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cursor))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.reports.db", return_value=ctx)
    return cursor


@pytest.mark.asyncio
async def test_export_stock_normalizes_brand_and_keeps_wms_join(
    test_client, api_key_headers, mocker, tmp_path
):
    """Stock export should filter by product brand alias, not raw cert_stock.brand."""
    mocker.patch("app.routes.reports.DATABASE_URL", "postgres://test")
    cursor = _patch_reports_db(mocker, rows=[{"sku": "PI4257Y", "source": "wms_biguacu"}])
    output = tmp_path / "estoque.xlsx"
    output.write_bytes(b"PK\x03\x04xlsx")
    mocker.patch("app.routes.reports.generate_stock_report", return_value=output)

    resp = await test_client.post(
        "/api/reports/export-stock?brand=puket_escolares",
        headers=api_key_headers,
    )

    assert resp.status_code == 200
    sql, params = cursor.execute.call_args.args
    assert "COALESCE(cp.brand, cs.brand" in sql
    assert params == ["puket escolares"]


@pytest.mark.asyncio
async def test_export_stock_permission_error_is_actionable(
    test_client, api_key_headers, mocker
):
    """Permission errors on cert-reports should return a clear operational message."""
    mocker.patch("app.routes.reports.DATABASE_URL", "postgres://test")
    _patch_reports_db(mocker)
    mocker.patch("app.routes.reports.generate_stock_report", side_effect=PermissionError())

    resp = await test_client.post("/api/reports/export-stock", headers=api_key_headers)

    assert resp.status_code == 500
    assert "cert-reports" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_reports_list_includes_format(test_client, api_key_headers, mocker, tmp_path):
    """The frontend uses format to hide JSON-only actions for generated XLSX files."""
    mocker.patch("app.routes.reports.REPORTS_DIR", tmp_path)
    (tmp_path / "validation.json").write_text("{}", encoding="utf-8")
    (tmp_path / "estoque.xlsx").write_bytes(b"PK\x03\x04xlsx")

    resp = await test_client.get("/api/reports", headers=api_key_headers)

    assert resp.status_code == 200
    formats = {item["filename"]: item["format"] for item in resp.json()}
    assert formats["validation.json"] == "json"
    assert formats["estoque.xlsx"] == "xlsx"


@pytest.mark.asyncio
async def test_report_data_rejects_xlsx(test_client, api_key_headers, mocker, tmp_path):
    """XLSX files are binary and should not be parsed through the JSON detail endpoint."""
    mocker.patch("app.routes.reports.REPORTS_DIR", tmp_path)
    (tmp_path / "estoque.xlsx").write_bytes(b"PK\x03\x04xlsx")

    resp = await test_client.get("/api/reports/estoque.xlsx/data", headers=api_key_headers)

    assert resp.status_code == 400
    assert "JSON" in resp.json()["detail"]


def test_generate_stock_report_writes_synced_at_column(mocker, tmp_path):
    """Generated stock XLSX should include the sync timestamp for WMS auditability."""
    mocker.patch("app.services.report_service.REPORTS_DIR", tmp_path)
    output = generate_stock_report(
        [
            {
                "sku": "PI4257Y",
                "name": "Produto",
                "brand": "Puket",
                "source": "wms_biguacu",
                "warehouse": "CD Picking",
                "quantity": 10,
                "available": 8,
                "reserved": 1,
                "in_transit": 2,
                "situation": "LIBERADO",
                "last_validation_status": "OK",
                "sale_deadline": "2026-12-31",
                "synced_at": datetime(2026, 6, 19, 12, 0, tzinfo=UTC),
            }
        ]
    )

    wb = openpyxl.load_workbook(output)
    ws = wb["Estoque Detalhado"]
    headers = [cell.value for cell in ws[5]]
    assert "Sincronizado em" in headers
    assert ws["M6"].value.startswith("2026-06-19T12:00:00")
