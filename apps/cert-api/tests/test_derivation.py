"""Tests for status derivation (feedback Eduarda 2026-06-19).

Cobre os colapsos pedidos:
- cert_status SOMENTE ATIVO | ENCERRADO
- site_status SOMENTE CONFORME | NAO_CONFORME (com frase obrigatória)
- license_status vindo da aba 'Licenciamentos Vencidos' (NAO_APLICAVEL fallback)
- PI4257Y e PI5101Y -> ENCERRADO
"""

import itertools

import pytest

from app.services.derivation import (
    CERT_STATUS_VALUES,
    SITE_REASON_PENDING,
    SITE_STATUS_VALUES,
    compute_status_dimensions,
    derive_cert_status,
    derive_license_status,
    derive_site_status,
)


# ---------------------------------------------------------------------------
# cert_status: somente ATIVO | ENCERRADO
# ---------------------------------------------------------------------------

class TestCertStatusCollapsed:
    SHEET_TEXTS = [
        "Ativo", "ativo", "Em andamento", "andamento", "SKU excluído",
        "Encerrado", "EXPIRED", "EXPIRING", "Vencido", "Finalizado",
        "", None, "01/09/25 - Registro concedido", "Desconhecido", "qualquer texto",
    ]
    DEADLINES = [None, "", "Vencido", "Fim do lote", "Venda até fim do lote", "2030-01-01"]

    @pytest.mark.parametrize(
        "sheet,expired,deadline",
        itertools.product(SHEET_TEXTS, [True, False], DEADLINES),
    )
    def test_cert_status_only_two_values(self, sheet, expired, deadline):
        status = derive_cert_status(sheet, expired, deadline)
        assert status in {"ATIVO", "ENCERRADO"}
        assert status in CERT_STATUS_VALUES

    def test_excluido_is_encerrado(self):
        assert derive_cert_status("SKU excluído", False, None) == "ENCERRADO"

    def test_excluido_precedes_sale_window(self):
        # Regra Eduarda: "Encerrado = certificação encerrada, SKU excluído OU
        # fora do prazo de venda". SKU excluído SEMPRE é ENCERRADO, mesmo dentro
        # da janela de venda (a verificação de exclusão precede o short-circuit
        # de within_window).
        assert (
            derive_cert_status("SKU excluído", False, "Venda até fim do lote")
            == "ENCERRADO"
        )

    def test_excluido_precedes_sale_window_not_expired(self):
        assert (
            derive_cert_status("SKU excluido", False, "fim do lote") == "ENCERRADO"
        )

    def test_andamento_defaults_encerrado(self):
        assert derive_cert_status("Em andamento", False, None) == "ENCERRADO"

    def test_andamento_within_sale_window_is_ativo(self):
        assert derive_cert_status("Em andamento", False, "Venda até fim do lote") == "ATIVO"

    def test_desconhecido_is_encerrado(self):
        # Texto livre não reconhecido + sem prazo -> conservador ENCERRADO.
        assert derive_cert_status("Desconhecido", False, None) == "ENCERRADO"

    def test_ativo_text_but_expired_is_encerrado(self):
        # "Ativo" obsoleto com flag de expiração e fora da janela -> ENCERRADO.
        assert derive_cert_status("Ativo", True, "Vencido") == "ENCERRADO"

    def test_clean_active_stays_ativo(self):
        assert derive_cert_status("Ativo", False, "2030-01-01") == "ATIVO"

    def test_sale_window_flips_expired_to_ativo(self):
        assert derive_cert_status("EXPIRED", True, "Venda até fim do lote") == "ATIVO"


class TestKnownBadProcesses:
    """PI4257Y e PI5101Y devem resolver para ENCERRADO."""

    def test_pi4257y_was_ativo_now_encerrado(self):
        # Carregava "Ativo" mas o licenciamento/prazo terminou (expirado, fora da janela).
        result = compute_status_dimensions(
            {
                "sku": "PI4257Y",
                "sheet_status": "Ativo",
                "is_expired": True,
                "sale_deadline": "Vencido",
                "certification_type": "INMETRO",
                "expected_cert_text": "INMETRO",
                "last_validation_status": "OK",
            }
        )
        assert result["cert_status"] == "ENCERRADO"

    def test_pi5101y_was_em_andamento_now_encerrado(self):
        result = compute_status_dimensions(
            {
                "sku": "PI5101Y",
                "sheet_status": "Em andamento",
                "is_expired": False,
                "sale_deadline": "",
                "certification_type": "INMETRO",
                "expected_cert_text": "INMETRO",
                "last_validation_status": "OK",
            }
        )
        assert result["cert_status"] == "ENCERRADO"


# ---------------------------------------------------------------------------
# site_status: somente CONFORME | NAO_CONFORME (+ frase obrigatória)
# ---------------------------------------------------------------------------

class TestSiteStatusCollapsed:
    VALIDATION_STATES = [
        None, "", "OK", "EXPIRED", "URL_NOT_FOUND", "NO_EXPECTED",
        "MISSING", "INCONSISTENT", "API_ERROR",
    ]

    @pytest.mark.parametrize("vs", VALIDATION_STATES)
    @pytest.mark.parametrize("cs", ["ATIVO", "ENCERRADO"])
    def test_site_status_only_two_values(self, vs, cs):
        status, reason = derive_site_status(vs, cs, "INMETRO", "INMETRO")
        assert status in {"CONFORME", "NAO_CONFORME"}
        assert status in SITE_STATUS_VALUES
        # Nunca um terceiro estado silencioso: NAO_CONFORME sempre tem frase.
        if status == "NAO_CONFORME":
            assert reason
            assert isinstance(reason, str)

    def test_unknown_validation_is_nao_conforme_with_reason(self):
        status, reason = derive_site_status(None, "ATIVO", "INMETRO", "INMETRO")
        assert status == "NAO_CONFORME"
        assert reason == SITE_REASON_PENDING

    def test_empty_validation_is_nao_conforme_with_reason(self):
        status, reason = derive_site_status("", "ATIVO", "INMETRO", "INMETRO")
        assert status == "NAO_CONFORME"
        assert reason == SITE_REASON_PENDING

    def test_not_on_site_active_is_conforme(self):
        status, reason = derive_site_status("URL_NOT_FOUND", "ATIVO", "INMETRO", "INMETRO")
        assert status == "CONFORME"
        assert reason is None

    def test_encerrado_on_site_is_nao_conforme(self):
        status, reason = derive_site_status("OK", "ENCERRADO", "INMETRO", "INMETRO")
        assert status == "NAO_CONFORME"
        assert reason

    def test_active_ok_is_conforme(self):
        status, reason = derive_site_status("OK", "ATIVO", "INMETRO", "INMETRO")
        assert status == "CONFORME"

    def test_error_state_carries_mandatory_phrase(self):
        status, reason = derive_site_status("API_ERROR", "ATIVO", "INMETRO", "INMETRO")
        assert status == "NAO_CONFORME"
        assert reason == SITE_REASON_PENDING

    def test_compute_exposes_site_status_reason(self):
        result = compute_status_dimensions(
            {
                "sku": "X1",
                "sheet_status": "Ativo",
                "is_expired": False,
                "sale_deadline": "2030-01-01",
                "certification_type": "INMETRO",
                "expected_cert_text": "INMETRO",
                "last_validation_status": None,  # nunca validado
            }
        )
        assert result["site_status"] == "NAO_CONFORME"
        assert result["site_status_reason"] == SITE_REASON_PENDING


# ---------------------------------------------------------------------------
# license_status: aba 'Licenciamentos Vencidos'
# ---------------------------------------------------------------------------

class TestLicenseStatus:
    def test_no_row_is_nao_aplicavel(self):
        status, deadline = derive_license_status(None)
        assert status == "NAO_APLICAVEL"
        assert deadline is None

    def test_vencido_row(self):
        status, deadline = derive_license_status(
            {"status": "VENCIDO", "valid_until": "2024-01-01"}
        )
        assert status == "VENCIDO"
        assert deadline == "2024-01-01"

    def test_valido_row(self):
        status, deadline = derive_license_status(
            {"status": "VALIDO", "valid_until": "2030-12-31"}
        )
        assert status == "VALIDO"
        assert deadline == "2030-12-31"

    def test_unrecognized_status_is_nao_aplicavel(self):
        status, _ = derive_license_status({"status": "???", "valid_until": None})
        assert status == "NAO_APLICAVEL"

    def test_compute_matches_by_sku(self):
        result = compute_status_dimensions(
            {
                "sku": "PI4257Y",
                "sheet_status": "Ativo",
                "is_expired": False,
                "sale_deadline": "2030-01-01",
                "certification_type": "INMETRO",
                "expected_cert_text": "INMETRO",
                "last_validation_status": "OK",
            },
            license_map={"PI4257Y": {"status": "VENCIDO", "valid_until": "2024-05-01"}},
        )
        assert result["license_status"] == "VENCIDO"
        assert result["license_deadline"] == "2024-05-01"

    def test_compute_no_match_is_nao_aplicavel(self):
        result = compute_status_dimensions(
            {
                "sku": "OTHER",
                "sheet_status": "Ativo",
                "is_expired": False,
                "sale_deadline": "2030-01-01",
                "certification_type": "INMETRO",
                "expected_cert_text": "INMETRO",
                "last_validation_status": "OK",
            },
            license_map={"PI4257Y": {"status": "VENCIDO", "valid_until": "2024-05-01"}},
        )
        assert result["license_status"] == "NAO_APLICAVEL"
        assert result["license_deadline"] is None
