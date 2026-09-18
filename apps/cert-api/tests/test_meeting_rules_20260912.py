"""Regressoes das regras confirmadas em 12/09; fixtures sinteticas, sem rede."""

from datetime import date

import pytest

from app.services.derivation import compute_status_dimensions, derive_cert_status, derive_trava_venda
from app.services.erp_service import _ATIVOS_SHEETS, _read_ativos_from_sheets, _resolve_columns
from tests.test_erp_sheets import MARCA_HEADERS, _FakeSpreadsheet

TODAY = date(2026, 9, 12)


@pytest.mark.parametrize("deadline", ["2030-01-01", "Venda ate fim do lote", "", None])
def test_sale_window_does_not_reactivate_a_closed_certificate(deadline):
    assert derive_cert_status("Encerrado", False, deadline) == "ENCERRADO"


@pytest.mark.parametrize("raw", [None, "", "0", 0, "1900-01-01", "nao e data"])
def test_unknown_license_is_pending_and_never_automatically_released(raw):
    result = compute_status_dimensions({"situacao": "Ativo", "linx_fim_licenciamento": raw}, today=TODAY)
    assert result["license_status"] == "PENDENTE"
    assert result["status_venda"] == "BLOQUEADA"
    assert result["comercializacao_status"] == "PENDENTE"
    assert "Linx" in result["status_venda_reason"]
    assert result["trava_venda"] is None


def test_known_license_non_applicability_is_distinct_from_unknown():
    result = compute_status_dimensions({"situacao": "Ativo", "licenciamento_aplicavel": False}, today=TODAY)
    assert result["license_status"] == "NAO_APLICAVEL"
    assert result["status_venda"] == "LIBERADA"


def test_active_with_expired_validity_keeps_declared_status_and_exposes_conflict():
    result = compute_status_dimensions(
        {"situacao": "Ativo", "validade_certificado": "2026-09-11", "licenciamento_aplicavel": False}, today=TODAY
    )
    assert result["cert_status"] == "ATIVO"
    assert result["trava_venda"] is None
    assert result["status_venda"] == "BLOQUEADA"
    assert "validade vencida" in result["cert_status_reason"]


def test_licensing_deadline_blocks_active_certificate():
    result = compute_status_dimensions({"situacao": "Ativo", "linx_fim_licenciamento": "2026-09-11"}, today=TODAY)
    assert result["cert_status"] == "ATIVO"
    assert result["license_status"] == "VENCIDO"
    assert result["status_venda"] == "BLOQUEADA"
    assert result["comercializacao_status"] == "ENCERRADA"


@pytest.mark.parametrize(
    "cert,license_,expected",
    [
        ("2026-10-05", "2026-12-05", "2026-10-05"),
        ("2026-12-05", "2026-10-05", "2026-10-05"),
        ("2026-10-05", "2026-10-05", "2026-10-05"),
        ("1900-01-01", "2026-10-05", "2026-10-05"),
        ("2026-10-05", None, "2026-10-05"),
    ],
)
def test_minimum_valid_applicable_deadline(cert, license_, expected):
    deadline, _ = derive_trava_venda(cert, license_, "ENCERRADO")
    assert deadline.isoformat() == expected


@pytest.mark.parametrize(
    "today,expected", [(date(2026, 9, 11), "LIBERADA"), (TODAY, "LIBERADA"), (date(2026, 9, 13), "BLOQUEADA")]
)
def test_existing_inclusive_boundary_in_business_calendar(today, expected):
    # Fronteira atual preservada; homologacao da area ainda necessaria.
    result = compute_status_dimensions(
        {
            "situacao": "Encerrado",
            "sale_deadline_date": "2026-09-12",
            "encerramento_status": "Comercializacao Permitida",
        },
        today=today,
    )
    assert result["cert_status"] == "ENCERRADO"
    assert result["status_venda"] == expected


def test_renamed_required_header_does_not_fall_back_to_column_letter():
    headers = list(MARCA_HEADERS)
    headers[13] = "Campo desconhecido"
    cols = _resolve_columns(headers, _ATIVOS_SHEETS[0]["fields"], "Puket")
    assert cols["validade_certificado"] is None


def test_duplicate_header_does_not_choose_first_column():
    headers = list(MARCA_HEADERS) + ["SITUAÇÃO"]
    cols = _resolve_columns(headers, _ATIVOS_SHEETS[0]["fields"], "Puket")
    assert cols["situacao"] is None


def test_strict_sync_rejects_unreadable_brand_before_selection():
    with pytest.raises(ValueError, match="Leitura incompleta"):
        _read_ativos_from_sheets(_FakeSpreadsheet({}), strict=True)


def test_strict_sync_rejects_two_active_suppliers_for_same_sku():
    row = [""] * len(MARCA_HEADERS)
    row[2], row[4], row[15], row[20] = "050404509", "Fornecedor A", "CERT-1", "Ativo"
    other = list(row)
    other[4] = "Fornecedor B"
    sheets = _FakeSpreadsheet(
        {"Imaginarium": [MARCA_HEADERS, row, other], "Puket": [MARCA_HEADERS, ["", "", "SKU-OTHER"]]}
    )
    with pytest.raises(ValueError, match="Vinculo.*ambiguo.*050404509"):
        _read_ativos_from_sheets(sheets, strict=True)


def test_force_refresh_records_linx_error_not_success(mocker):
    from app.services import sync_runs

    mocker.patch.object(sync_runs, "DATABASE_URL", "")
    mocker.patch.object(sync_runs, "start_sync_run", return_value="run-1")
    finish = mocker.patch.object(sync_runs, "finish_sync_run")
    sheets = mocker.patch("app.services.erp_service.sync_sheets_to_db", return_value={"synced": 1})
    linx = mocker.patch(
        "app.services.linx_attributes.sync_linx_attributes",
        return_value={"updated": 0, "errors": [{"error": "TimeoutError"}]},
    )
    result = sync_runs.run_sheet_sync("manual")
    sheets.assert_called_once()
    linx.assert_called_once()
    assert result["status"] == "error"
    assert finish.call_args.args[2] == result["error"]


def test_snapshot_warning_survives_failed_sync_without_expiring_snapshot(mocker):
    from app.services import sync_runs

    mocker.patch.object(sync_runs, "DATABASE_URL", "configured")
    mocker.patch.object(
        sync_runs,
        "fetch_last_sync_run",
        return_value={
            "finished_at": "2026-09-12T15:00:00Z",
            "error": None,
            "result": {"sheets": {"synced": 0}, "linx": {"errors": [{"error": "TimeoutError"}]}},
        },
    )
    assert "atualizados parcialmente" in sync_runs.snapshot_sync_warning()


def test_unknown_certificate_situation_is_pending_even_with_future_sale_date():
    result = compute_status_dimensions(
        {"sheet_status": "Aguardando resposta", "sale_deadline_date": "2030-01-01"}, today=TODAY
    )
    assert result["cert_status"] == "ENCERRADO"
    assert result["comercializacao_status"] == "PENDENTE"
    assert result["cert_status_reason"]


def test_current_active_certificate_overrides_old_exclusion_history():
    result = compute_status_dimensions(
        {"situacao": "Ativo", "sheet_status": "2024 - SKU excluido", "linx_fim_licenciamento": "2030-01-01"},
        today=TODAY,
    )
    assert result["cert_status"] == "ATIVO"
    assert result["status_venda"] == "LIBERADA"


def test_current_individual_exclusion_is_not_overridden_by_future_license():
    result = compute_status_dimensions(
        {"situacao": "SKU excluido", "sheet_status": "Registro concedido", "linx_fim_licenciamento": "2030-01-01"},
        today=TODAY,
    )
    assert result["cert_status"] == "ENCERRADO"
    assert result["status_venda"] == "BLOQUEADA"


def test_linx_is_still_read_after_sheets_error(mocker):
    """De 12 a 18/09/2026 a planilha recusada pulou o Linx 145 vezes: licenciamento nunca carregou."""
    from app.services import sync_runs

    mocker.patch.object(sync_runs, "DATABASE_URL", "")
    mocker.patch.object(sync_runs, "start_sync_run", return_value="run-1")
    finish = mocker.patch.object(sync_runs, "finish_sync_run")
    mocker.patch("app.services.erp_service.sync_sheets_to_db", return_value={"synced": 0, "error": "Esquema invalido"})
    linx = mocker.patch("app.services.linx_attributes.sync_linx_attributes", return_value={"updated": 674, "errors": []})
    result = sync_runs.run_sheet_sync("manual")
    linx.assert_called_once()
    assert result["linx"] == {"updated": 674, "errors": []}
    # A execucao continua sendo erro: a planilha nao foi aplicada.
    assert result["status"] == "error"
    assert "planilha falhou" in result["error"] and "Linx concluida" in result["error"]
    assert finish.call_args.args[1]["sheets"]["error"] == "Esquema invalido"
    assert finish.call_args.args[2] == result["error"]


def test_sheets_and_linx_failing_together_are_both_reported(mocker):
    from app.services import sync_runs

    mocker.patch.object(sync_runs, "DATABASE_URL", "")
    mocker.patch.object(sync_runs, "start_sync_run", return_value="run-1")
    mocker.patch.object(sync_runs, "finish_sync_run")
    mocker.patch("app.services.erp_service.sync_sheets_to_db", return_value={"synced": 0, "error": "Esquema invalido"})
    mocker.patch("app.services.linx_attributes.sync_linx_attributes", side_effect=TimeoutError("linx"))
    result = sync_runs.run_sheet_sync("hourly")
    assert result["status"] == "error"
    assert result["linx"] == {"error": "TimeoutError"}
    assert "Linx tambem falhou" in result["error"]


@pytest.mark.parametrize("rows,reason", [([], "sem cabecalho"), ([MARCA_HEADERS], "sem dados")])
def test_strict_brand_reader_distinguishes_missing_header_from_empty_data(rows, reason):
    with pytest.raises(ValueError, match=reason):
        _read_ativos_from_sheets(_FakeSpreadsheet({"Imaginarium": rows}), strict=True)


@pytest.mark.parametrize("has_header", [False, True])
def test_strict_encerramentos_rejects_missing_header_or_unconfirmed_empty_data(has_header):
    from app.services.erp_service import _read_encerramentos_from_sheets
    from tests.test_erp_sheets import ENCERRAMENTOS_HEADERS

    rows = [ENCERRAMENTOS_HEADERS] if has_header else []
    with pytest.raises(ValueError, match="sem dados" if has_header else "sem cabecalho"):
        _read_encerramentos_from_sheets(_FakeSpreadsheet({"Encerramentos": rows}), strict=True)


def test_sync_missing_header_does_not_mutate_snapshot(mocker):
    from app.services import erp_service

    client = mocker.Mock()
    client.open_by_key.return_value = _FakeSpreadsheet({"Imaginarium": []})
    mocker.patch.object(erp_service, "_get_sheets_client", return_value=client)
    mocker.patch.object(erp_service, "SHEETS_SPREADSHEET_ID", "synthetic-sheet")
    database = mocker.patch.object(erp_service, "db")
    result = erp_service.sync_sheets_to_db()
    assert result["synced"] == 0
    assert "sem cabecalho" in result["error"]
    database.assert_not_called()


def test_blank_source_history_does_not_preserve_stale_activity():
    from app.services.erp_service import _UPSERT_ATIVOS_SQL

    assert "sheet_status = EXCLUDED.sheet_status" in _UPSERT_ATIVOS_SQL
    result = compute_status_dimensions(
        {"sheet_status": "", "situacao": "", "licenciamento_aplicavel": False}, today=TODAY
    )
    assert result["comercializacao_status"] == "PENDENTE"
    assert result["cert_status_reason"]


def test_strict_readers_reject_only_blank_rows_after_header():
    from app.services.erp_service import _read_encerramentos_from_sheets
    from tests.test_erp_sheets import ENCERRAMENTOS_HEADERS

    with pytest.raises(ValueError, match="sem dados"):
        _read_ativos_from_sheets(_FakeSpreadsheet({"Imaginarium": [MARCA_HEADERS, ["", "", ""]]}), strict=True)
    with pytest.raises(ValueError, match="sem dados"):
        _read_encerramentos_from_sheets(
            _FakeSpreadsheet({"Encerramentos": [ENCERRAMENTOS_HEADERS, ["", "", ""]]}), strict=True
        )
