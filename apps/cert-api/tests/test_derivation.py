"""Tests for status derivation (feedback Eduarda 2026-06-19).

Cobre os colapsos pedidos:
- cert_status SOMENTE ATIVO | ENCERRADO
- site_status SOMENTE CONFORME | NAO_CONFORME (com frase obrigatória)
- license_status vindo da aba 'Licenciamentos Vencidos' (NAO_APLICAVEL fallback)
- PI4257Y e PI5101Y -> ENCERRADO
"""

import itertools
from datetime import date, timedelta

import pytest

from app.services import derivation
from app.services.derivation import (
    CERT_STATUS_VALUES,
    SITE_REASON_PENDING,
    SITE_STATUS_VALUES,
    compute_status_dimensions,
    derive_cert_status,
    derive_comercializacao_status,
    derive_license_status,
    derive_site_status,
    derive_within_sale_deadline,
)

# ---------------------------------------------------------------------------
# cert_status: somente ATIVO | ENCERRADO
# ---------------------------------------------------------------------------


class TestCertStatusCollapsed:
    SHEET_TEXTS = [
        "Ativo",
        "ativo",
        "Em andamento",
        "andamento",
        "SKU excluído",
        "Encerrado",
        "EXPIRED",
        "EXPIRING",
        "Vencido",
        "Finalizado",
        "",
        None,
        "01/09/25 - Registro concedido",
        "Desconhecido",
        "qualquer texto",
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
        assert derive_cert_status("SKU excluído", False, "Venda até fim do lote") == "ENCERRADO"

    def test_excluido_precedes_sale_window_not_expired(self):
        assert derive_cert_status("SKU excluido", False, "fim do lote") == "ENCERRADO"

    def test_andamento_defaults_encerrado(self):
        assert derive_cert_status("Em andamento", False, None) == "ENCERRADO"

    # ── Caso Eduarda 2026-07-17 (PI7550Y/PI7551Y/PI7553Y) ────────────────────
    def test_registro_concedido_is_ativo(self):
        # "Registro concedido" = certificação ATIVA; 26 produtos em prod exibiam
        # Encerrado porque o marcador não era reconhecido.
        assert (
            derive_cert_status("01/09/25 - Registro concedido no Orquestra.", False, None)
            == "ATIVO"
        )

    def test_inclusao_concedida_typo_is_ativo(self):
        # Typo real da planilha: "concecida".
        assert derive_cert_status("21/08/24 - Inclusão concecida no Orquestra.", False, None) in {
            "ATIVO",
            "ENCERRADO",
        }
        # O typo "concecida" não contém "conce"+"did"; o marcador usa "conce".
        assert (
            derive_cert_status("21/08/24 - Inclusão concecida no Orquestra.", False, None)
            == "ATIVO"
        )

    def test_registro_concedido_expirado_is_encerrado(self):
        # Concessão antiga + expirado → guarda de expiração continua mandando.
        assert (
            derive_cert_status("01/09/25 - Registro concedido no Orquestra.", True, None)
            == "ENCERRADO"
        )

    def test_historico_multilinha_entrada_mais_recente_decide(self):
        # Log real: manutenção finalizada (recente) por cima de um encerramento
        # antigo — o substring no texto inteiro deixava a entrada VELHA vencer.
        log = (
            "13/03/2026 - Manutenção Finalizada\n"
            "25/11/24 - Registro encerrado.\n"
            "01/12 - Registro concedido. Número do Registro: 011828/2022."
        )
        assert derive_cert_status(log, False, None) == "ATIVO"

    def test_historico_multilinha_encerrado_recente_decide(self):
        # Direção oposta: encerramento é a entrada mais recente → ENCERRADO,
        # mesmo com concessão/finalização antigas abaixo.
        log = "25/11/25 - Registro encerrado.\n13/03/2024 - Manutenção Finalizada"
        assert derive_cert_status(log, False, None) == "ENCERRADO"

    def test_historico_multilinha_excluido_em_qualquer_linha_e_terminal(self):
        # Exclusão é estado terminal — vale mesmo fora da primeira linha.
        log = "13/03/2026 - Manutenção Finalizada\n01/02/25 - SKU excluído do portfólio."
        assert derive_cert_status(log, False, None) == "ENCERRADO"

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
        None,
        "",
        "OK",
        "EXPIRED",
        "URL_NOT_FOUND",
        "NO_EXPECTED",
        "MISSING",
        "INCONSISTENT",
        "API_ERROR",
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
# Prazo de comercialização vigente (feedback Eduarda 2026-07-16)
# ---------------------------------------------------------------------------


# sheet_status real do PI4511Y em produção: log de eventos, não um status limpo.
PI4511Y_SHEET_STATUS = (
    "18/03/2026 - Certificado encerrado, carta de encerramento recebido 03/03/2026, "
    "N° de registro encerrado no orquestra em 18/03\n"
    "03/03/2026 Recebido a carta de encerramento\n"
    "23/04/2025 - Manutenção finalizada.\n"
    "03/06/24 - Manutenção concluída.\n"
    "Retrabalho das canetas concluído."
)


class TestWithinSaleDeadline:
    def test_future_date_is_within(self):
        assert derive_within_sale_deadline("Encerrado", "02/03/2028", date(2028, 3, 2), date(2026, 7, 16))

    def test_past_date_is_not_within(self):
        assert not derive_within_sale_deadline("Encerrado", "02/03/2024", date(2024, 3, 2), date(2026, 7, 16))

    def test_deadline_today_is_still_within(self):
        # Prazo até 16/07/2026 significa que ainda se pode vender NO dia 16.
        today = date(2026, 7, 16)
        assert derive_within_sale_deadline("Encerrado", "16/07/2026", today, today)

    def test_textual_window_is_within_without_date(self):
        assert derive_within_sale_deadline("Encerrado", "Venda até fim do lote", None, date(2026, 7, 16))

    def test_no_deadline_is_not_within(self):
        assert not derive_within_sale_deadline("Encerrado", None, None, date(2026, 7, 16))

    def test_vencido_text_is_not_within(self):
        assert not derive_within_sale_deadline("Encerrado", "Vencido", None, date(2026, 7, 16))

    def test_excluded_sku_never_within_despite_future_deadline(self):
        # Regra Eduarda: exclusão de SKU precede a janela de venda.
        assert not derive_within_sale_deadline("SKU excluído", "02/03/2028", date(2028, 3, 2), date(2026, 7, 16))

    def test_falls_back_to_raw_text_when_date_column_absent(self):
        # Callers que projetam só `sale_deadline` (sem a coluna DATE) nao podem
        # divergir da tabela.
        assert derive_within_sale_deadline("Encerrado", "02/03/2028", None, date(2026, 7, 16))

    def test_vencido_text_beats_stale_future_date(self):
        # O upsert do sync faz COALESCE e nunca limpa sale_deadline_date: um item
        # que virou "Vencido" na planilha conserva a data antiga. O texto manda —
        # igual a derive_cert_status — senao um item vencido voltaria a "vigente".
        assert not derive_within_sale_deadline(
            "Encerrado", "Vencido", date(2028, 3, 2), date(2026, 7, 16)
        )


class TestEncerradaDentroDoPrazo:
    """PI4511Y: cert encerrada + prazo 02/03/2028 vigente -> Conforme no site.

    O relógio é injetado (`HOJE`) para o cenário do PI4511Y continuar sendo o
    mesmo depois de 02/03/2028 — sem isso a suíte passaria a falhar sozinha no dia
    em que o prazo real vencer.
    """

    HOJE = date(2026, 7, 16)  # data do reporte da Eduarda

    def _pi4511y(self, today_deadline="02/03/2028", deadline_date=date(2028, 3, 2)):
        return {
            "sku": "PI4511Y",
            "name": "CANETA MUDA FRASES HP FEITICOS",
            "sheet_status": PI4511Y_SHEET_STATUS,
            "is_expired": False,
            "sale_deadline": today_deadline,
            "sale_deadline_date": deadline_date,
            "certification_type": "INMETRO SISTEMA 5 (FABRICA) - PORTARIA 481",
            "expected_cert_text": "INMETRO",
            "last_validation_status": "OK",
        }

    def test_pi4511y_cert_stays_encerrado(self):
        # A certificação está encerrada de fato — isso continua correto.
        result = compute_status_dimensions(self._pi4511y(), today=self.HOJE)
        assert result["cert_status"] == "ENCERRADO"

    def test_pi4511y_site_status_is_conforme(self):
        # O bug relatado: marcava NAO_CONFORME mesmo dentro do prazo de venda.
        result = compute_status_dimensions(self._pi4511y(), today=self.HOJE)
        assert result["site_status"] == "CONFORME"
        assert result["site_status_reason"] is None

    def test_pi4511y_comercializacao_is_dentro_prazo(self):
        result = compute_status_dimensions(self._pi4511y(), today=self.HOJE)
        assert result["comercializacao_status"] == "DENTRO_PRAZO"

    def test_same_product_past_deadline_is_nao_conforme(self):
        # Passado o prazo, volta a ser irregular no site.
        result = compute_status_dimensions(
            self._pi4511y(today_deadline="02/03/2024", deadline_date=date(2024, 3, 2)),
            today=self.HOJE,
        )
        assert result["cert_status"] == "ENCERRADO"
        assert result["site_status"] == "NAO_CONFORME"
        assert result["site_status_reason"]
        assert result["comercializacao_status"] == "ENCERRADA"

    def test_encerrada_within_deadline_but_off_site_is_conforme(self):
        row = self._pi4511y()
        row["last_validation_status"] = "URL_NOT_FOUND"
        result = compute_status_dimensions(row, today=self.HOJE)
        assert result["site_status"] == "CONFORME"

    def test_excluded_sku_within_deadline_is_still_nao_conforme(self):
        row = self._pi4511y()
        row["sheet_status"] = "SKU excluído"
        result = compute_status_dimensions(row, today=self.HOJE)
        assert result["cert_status"] == "ENCERRADO"
        assert result["site_status"] == "NAO_CONFORME"
        assert result["comercializacao_status"] == "ENCERRADA"

    def test_deadline_date_as_iso_string_is_honored(self):
        # psycopg2 devolve DATE; exports/mocks podem devolver string ISO.
        row = self._pi4511y(deadline_date="2028-03-02")
        assert compute_status_dimensions(row, today=self.HOJE)["site_status"] == "CONFORME"

    def test_dynamic_future_deadline_is_conforme_without_frozen_date(self):
        # Sem congelar o relógio: prazo sempre futuro relativo a hoje.
        future = date.today() + timedelta(days=365)
        row = self._pi4511y(today_deadline=future.strftime("%d/%m/%Y"), deadline_date=future)
        assert compute_status_dimensions(row, today=self.HOJE)["site_status"] == "CONFORME"

    def test_comercializacao_encerrada_when_no_deadline(self):
        assert derive_comercializacao_status("ENCERRADO", None, "Encerrado", False) == "ENCERRADA"

    # O prazo vigente absolve a certificação encerrada, NÃO absolve problema de
    # conteúdo/verificação no site: dentro do prazo o item é julgado igual a um ATIVO.
    @pytest.mark.parametrize(
        "vs,expected_status",
        [
            ("OK", "CONFORME"),
            ("URL_NOT_FOUND", "CONFORME"),
            ("INCONSISTENT", "NAO_CONFORME"),  # frase da página não bate com a esperada
            ("MISSING", "NAO_CONFORME"),
            ("API_ERROR", "NAO_CONFORME"),  # VTEX fora do ar: não dá para afirmar conforme
            ("EXPIRED", "NAO_CONFORME"),  # contradiz o prazo vigente -> revisar
        ],
    )
    def test_within_deadline_is_judged_like_ativo(self, vs, expected_status):
        encerrado, reason_enc = derive_site_status(vs, "ENCERRADO", "INMETRO", "INMETRO", True)
        assert encerrado == expected_status
        # Mesma resposta que um produto ATIVO — o prazo vigente equipara os dois.
        ativo, reason_ativo = derive_site_status(vs, "ATIVO", "INMETRO", "INMETRO", False)
        assert (encerrado, reason_enc) == (ativo, reason_ativo)

    @pytest.mark.parametrize("vs", ["OK", "URL_NOT_FOUND", "MISSING", "INCONSISTENT", "API_ERROR"])
    def test_invariant_holds_with_deadline_flag(self, vs):
        # Nunca um terceiro estado silencioso: NAO_CONFORME sempre traz a frase.
        status, reason = derive_site_status(vs, "ENCERRADO", "INMETRO", "INMETRO", True)
        assert status in SITE_STATUS_VALUES
        if status == "NAO_CONFORME":
            assert reason

    def test_inconsistent_within_deadline_reaches_the_operator(self):
        # Regressão do defeito achado na revisão: produto no site com a frase de
        # certificação ERRADA não pode aparecer como Conforme só porque o prazo corre.
        row = self._pi4511y()
        row["last_validation_status"] = "INCONSISTENT"
        result = compute_status_dimensions(row, today=self.HOJE)
        assert result["site_status"] == "NAO_CONFORME"
        assert result["site_status_reason"] == SITE_REASON_PENDING
        # A comercialização segue liberada — são eixos independentes.
        assert result["comercializacao_status"] == "DENTRO_PRAZO"


# ---------------------------------------------------------------------------
# license_status: aba 'Licenciamentos Vencidos'
# ---------------------------------------------------------------------------


class TestLicenseStatus:
    def test_no_row_is_nao_aplicavel(self):
        status, deadline = derive_license_status(None)
        assert status == "NAO_APLICAVEL"
        assert deadline is None

    def test_vencido_row(self):
        status, deadline = derive_license_status({"status": "VENCIDO", "valid_until": "2024-01-01"})
        assert status == "VENCIDO"
        assert deadline == "2024-01-01"

    def test_valido_row(self):
        status, deadline = derive_license_status({"status": "VALIDO", "valid_until": "2030-12-31"})
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


# ---------------------------------------------------------------------------
# Feedback Eduarda 2026-08-07 — casos 100400496 / PI7560Y / PI7223Y
# ---------------------------------------------------------------------------


class TestSkuExcluidoEReincluido:
    """"Item excluído e incluído novamente" é REINCLUSÃO, não exclusão."""

    # Texto real de cert_products.sheet_status do PI7560Y em 07/08/2026.
    PI7560Y = (
        "27/10/25 - Item excluído e incluído novamente com o novo nome.\n"
        "01/09/25 - Registro concedido no Orquestra."
    )

    def test_reinclusao_nao_e_exclusao(self):
        assert derivation._is_sku_excluded(self.PI7560Y) is False

    def test_exclusao_pura_continua_valendo(self):
        assert derivation._is_sku_excluded("15/02/26 - SKU excluído do catálogo.") is True

    def test_entrada_mais_recente_decide(self):
        # Reincluído agora, excluído antes → vale a reinclusão.
        historico = (
            "10/03/26 - Item excluído e incluído novamente.\n"
            "05/01/26 - Item excluído."
        )
        assert derivation._is_sku_excluded(historico) is False

    def test_sem_mencao_a_exclusao(self):
        assert derivation._is_sku_excluded("01/09/25 - Registro concedido.") is False

    def test_pi7560y_fica_ativo_dentro_do_prazo(self):
        """O caso reportado: estava Encerrado/Nao conforme com venda permitida."""
        row = {
            "sku": "PI7560Y",
            "sheet_status": self.PI7560Y,
            "encerramento_status": "Comerciação Permitida",
            "last_validation_status": "OK",
        }
        dims = derivation.compute_status_dimensions(row)
        assert dims["cert_status"] == "ATIVO"
        assert dims["site_status"] == "CONFORME"
        assert dims["comercializacao_status"] == "DENTRO_PRAZO"


class TestVendaEncerramento:
    """Coluna H da aba 'Encerramentos' é o veredito sobre poder vender."""

    def test_permitida(self):
        assert derivation.derive_venda_encerramento("Comerciação Permitida") == "PERMITIDA"

    def test_bloqueada(self):
        assert derivation.derive_venda_encerramento("Vencido - Venda Bloqueada") == "BLOQUEADA"

    def test_bloqueada_recall(self):
        assert (
            derivation.derive_venda_encerramento("Vencido - Venda Bloqueada (Recall)")
            == "BLOQUEADA"
        )

    def test_fim_do_lote(self):
        assert derivation.derive_venda_encerramento("Venda até fim do lote") == "FIM_LOTE"

    def test_vazio_e_desconhecido_nao_liberam_venda(self):
        assert derivation.derive_venda_encerramento("") is None
        assert derivation.derive_venda_encerramento("qualquer coisa") is None

    def test_permitida_sem_data_mantem_prazo_vigente(self):
        """28 SKUs têm veredito na coluna H e NENHUMA data na coluna G."""
        assert (
            derivation.derive_within_sale_deadline(
                sheet_status="",
                sale_deadline_raw="",
                sale_deadline_date=None,
                encerramento_status="Comerciação Permitida",
            )
            is True
        )

    def test_bloqueada_vence_data_futura(self):
        """Data velha que sobrou no banco não pode reabrir a venda."""
        assert (
            derivation.derive_within_sale_deadline(
                sheet_status="",
                sale_deadline_raw="28/07/2028",
                sale_deadline_date="2028-07-28",
                encerramento_status="Vencido - Venda Bloqueada",
            )
            is False
        )

    def test_bloqueada_encerra_certificacao_e_comercializacao(self):
        row = {
            "sku": "PI7223Y",
            "sheet_status": "20/04/2026 - Não seguiremos com a manutenção.",
            "encerramento_status": "Vencido - Venda Bloqueada",
            "sale_deadline": "24/07/2026",
            "last_validation_status": "URL_NOT_FOUND",
        }
        dims = derivation.compute_status_dimensions(row)
        assert dims["cert_status"] == "ENCERRADO"
        assert dims["comercializacao_status"] == "ENCERRADA"
        assert dims["venda_encerramento"] == "BLOQUEADA"
