"""Tests for the 'Licenciamentos Vencidos' reader (erp_service).

Cobre o pedido de Eduarda 2026-06-19: licenciamento vem de uma aba própria, com
fallback NAO_APLICAVEL quando a aba não existe e VENCIDO/data quando há linha.
"""

import gspread
import pytest

import app.services.erp_service as erp_service


class _FakeWorksheet:
    def __init__(self, rows):
        self._rows = rows

    def get_all_values(self):
        return self._rows


class _FakeSpreadsheet:
    def __init__(self, worksheets):
        # worksheets: dict name -> rows, or a name that raises WorksheetNotFound
        self._worksheets = worksheets

    def worksheet(self, name):
        if name not in self._worksheets:
            raise gspread.exceptions.WorksheetNotFound(name)
        return _FakeWorksheet(self._worksheets[name])


class _FakeClient:
    def __init__(self, spreadsheet):
        self._spreadsheet = spreadsheet

    def open_by_key(self, key):
        return self._spreadsheet


def _patch_client(mocker, worksheets):
    client = _FakeClient(_FakeSpreadsheet(worksheets))
    mocker.patch.object(erp_service, "_get_sheets_client", return_value=client)


class TestReadLicenciamentosVencidos:
    def test_missing_tab_returns_empty(self, mocker):
        # Aba ausente -> dict vazio -> derive_license_status -> NAO_APLICAVEL.
        _patch_client(mocker, {"Outra": [["x"]]})
        result = erp_service.read_licenciamentos_vencidos()
        assert result == {}

        from app.services.derivation import derive_license_status

        status, deadline = derive_license_status(result.get("PI4257Y"))
        assert status == "NAO_APLICAVEL"
        assert deadline is None

    def test_no_client_returns_empty(self, mocker):
        mocker.patch.object(erp_service, "_get_sheets_client", return_value=None)
        assert erp_service.read_licenciamentos_vencidos() == {}

    def test_matching_row_returns_vencido_and_date(self, mocker):
        rows = [
            ["Processo", "Status", "Validade"],
            ["PI4257Y", "Vencido", "01/05/2024"],
            ["PI5101Y", "Válido", "31/12/2030"],
        ]
        _patch_client(mocker, {"Licenciamentos Vencidos": rows})
        result = erp_service.read_licenciamentos_vencidos()

        assert result["PI4257Y"] == {"status": "VENCIDO", "valid_until": "2024-05-01"}
        assert result["PI5101Y"] == {"status": "VALIDO", "valid_until": "2030-12-31"}

    def test_default_vencido_when_status_blank(self, mocker):
        # Aba de *vencidos*: ausência de "válido" no status -> VENCIDO.
        rows = [
            ["Processo", "Status", "Validade"],
            ["PI9999Z", "", "10/02/2023"],
        ]
        _patch_client(mocker, {"Licenciamentos Vencidos": rows})
        result = erp_service.read_licenciamentos_vencidos()
        assert result["PI9999Z"]["status"] == "VENCIDO"
        assert result["PI9999Z"]["valid_until"] == "2023-02-10"

    def test_keys_are_uppercased(self, mocker):
        rows = [
            ["Processo", "Status", "Validade"],
            ["pi4257y", "Vencido", "01/05/2024"],
        ]
        _patch_client(mocker, {"Licenciamentos Vencidos": rows})
        result = erp_service.read_licenciamentos_vencidos()
        assert "PI4257Y" in result
