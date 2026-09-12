"""Read-only preparation: incomplete sources never open a publish path."""

from datetime import date

import openpyxl
import pytest

from app.services import erp_service, linx_service
from tests.test_erp_sheets import ENCERRAMENTOS_HEADERS, MARCA_HEADERS, _FakeSpreadsheet
from tests.test_linx_service import TestSyncPrazoVenda as _SyncFixture
from tests.test_reports import _header_index, _patch_products_report_io


@pytest.mark.parametrize("rows", [[], [ENCERRAMENTOS_HEADERS], [ENCERRAMENTOS_HEADERS[:-1], ["C1", "050404509"]]])
def test_bulk_closure_reader_requires_complete_schema_and_data(monkeypatch, rows):
    monkeypatch.setattr(erp_service, "_bulk_source_spreadsheet", lambda: _FakeSpreadsheet({"Encerramentos": rows}))
    with pytest.raises(ValueError):
        erp_service.read_encerramentos_prazos()


def test_bulk_situation_reader_rejects_supplier_ambiguity(monkeypatch):
    row = [""] * len(MARCA_HEADERS)
    row[2], row[4], row[15], row[20] = "050404509", "A", "C1", "Ativo"
    other = list(row)
    other[4] = "B"
    spreadsheet = _FakeSpreadsheet(
        {"Imaginarium": [MARCA_HEADERS, row, other], "Puket": [MARCA_HEADERS, ["", "", "SKU2"]]}
    )
    monkeypatch.setattr(erp_service, "_bulk_source_spreadsheet", lambda: spreadsheet)
    with pytest.raises(ValueError, match="ambiguo"):
        erp_service.read_situacao_por_sku()


def test_bulk_preserves_h_deadline_n_evidence_and_textual_sku(monkeypatch):
    row = [""] * len(ENCERRAMENTOS_HEADERS)
    row[0], row[1], row[6], row[7], row[8], row[10], row[13] = (
        "C1",
        "050404509",
        "01/01/2026",
        "23/10/2026",
        "Encerrado",
        "Puket",
        "Sim",
    )
    monkeypatch.setattr(
        erp_service,
        "_bulk_source_spreadsheet",
        lambda: _FakeSpreadsheet({"Encerramentos": [ENCERRAMENTOS_HEADERS, row]}),
    )
    item = erp_service.read_encerramentos_prazos()[0]
    assert item["sku"] == "050404509"
    assert item["sale_deadline"] == "23/10/2026"
    assert item["dupla_certificacao_raw"] == "Sim"


def test_source_failure_is_error_not_empty_success(monkeypatch):
    def fail():
        raise ValueError("missing header")

    monkeypatch.setattr(erp_service, "read_encerramentos_prazos", fail)
    result = linx_service.sync_prazo_venda_to_linx()
    assert result["error"]
    assert result["baseline_complete"] is False
    assert not result["items"]


@pytest.mark.parametrize("flag", ["Sim", "validar", "1"])
def test_n_unvalidated_never_proposes_deadline(monkeypatch, tmp_path, flag):
    helper = _SyncFixture()
    rows = [
        {
            "sku": "050404509",
            "sale_deadline": "23/10/2026",
            "brand": "PUKET",
            "certificado": "C1",
            "dupla_certificacao_raw": flag,
        }
    ]
    svc, writes = helper._wire(monkeypatch, linhas=rows)
    monkeypatch.setattr(svc, "REPORTS_DIR", tmp_path)
    result = svc.sync_prazo_venda_to_linx()
    assert not writes
    assert result["items"][0]["valor_proposto"] is None
    assert result["items"][0]["acao"] == svc.ACAO_DUPLA
    assert result["baseline_complete"] is False


def test_export_preserves_unknown_snapshot_despite_live_license(mocker, tmp_path):
    from app.services.report_service import generate_products_report

    _patch_products_report_io(mocker, tmp_path, travas={"SKU": {"lic": "31/12/2030", "cert": None}})
    output = generate_products_report(
        [{"sku": "SKU", "situacao": "Ativo", "linx_fim_licenciamento": None}], today=date(2026, 9, 12)
    )
    sheet = openpyxl.load_workbook(output)["Produtos"]
    assert sheet.cell(8, _header_index(sheet, "Status Licenciamento")).value == "PENDENTE"
