"""Prazo final de venda avaliado no fuso de Brasilia, nao no fuso do processo.

`_read_encerramentos_from_sheets` decide `is_expired` com `prazo_date < today`.
Com `today` vindo de `datetime.now().date()` naive num container UTC, o dia vira
o SEGUINTE as 21:00 de Brasilia: um prazo que ainda valia por tres horas ja
aparecia como vencido no painel. E o mesmo defeito documentado em
`derivation.py:82`, que ali foi resolvido com `_today_sp()`.

O relogio e congelado nos DOIS modulos para que o teste distinga as duas
implementacoes de forma deterministica: a naive enxerga 29/08 e marca vencido, a
correta enxerga 28/08 e nao marca.
"""

from datetime import UTC, datetime

import pytest

from app.services import derivation, erp_service

# 2026-08-29 01:00 UTC == 2026-08-28 22:00 em America/Sao_Paulo.
# A janela das 21:00 as 00:00 de Brasilia e exatamente onde os dois fusos
# discordam sobre que dia e "hoje".
FIXED_INSTANT = datetime(2026, 8, 29, 1, 0, tzinfo=UTC)


class _FrozenDatetime(datetime):
    """`datetime` com `now()` congelado; herda `strptime` do real."""

    @classmethod
    def now(cls, tz=None):  # noqa: D102
        return FIXED_INSTANT.astimezone(tz) if tz else FIXED_INSTANT.replace(tzinfo=None)


HEADERS = ["CERTIFICADO", "SKU", "NOME", "PRAZO FINAL VENDA", "STATUS", "MARCA"]


def _sheet(mocker, rows: list[list[str]]):
    """Spreadsheet falso com a aba 'Encerramentos'."""
    ws = mocker.MagicMock()
    ws.get_all_values.return_value = [HEADERS, *rows]
    spreadsheet = mocker.MagicMock()
    spreadsheet.worksheet.return_value = ws
    return spreadsheet


@pytest.fixture
def frozen_clock(mocker):
    """Congela o relogio nos dois modulos que decidem o dia de hoje."""
    mocker.patch.object(derivation, "datetime", _FrozenDatetime)
    mocker.patch.object(erp_service, "datetime", _FrozenDatetime)


def _read_one(mocker, prazo: str, status: str = "") -> dict:
    rows = [["CERT-1", "SKU-1", "Produto 1", prazo, status, "Puket"]]
    out = erp_service._read_encerramentos_from_sheets(_sheet(mocker, rows))
    assert len(out) == 1
    return out[0]


def test_prazo_de_hoje_em_brasilia_nao_esta_vencido_as_22h(mocker, frozen_clock):
    """22:00 de 28/08 em Brasilia: um prazo de 28/08 ainda vale.

    Sob o relogio naive em UTC ja seria 29/08 e este item apareceria como
    vencido — dentro do dia util, para o time fiscal.
    """
    item = _read_one(mocker, "28/08/2026")

    assert item["is_expired"] is False


def test_prazo_de_ontem_continua_vencido(mocker, frozen_clock):
    """A correcao nao pode transformar vencido de verdade em vigente."""
    item = _read_one(mocker, "27/08/2026")

    assert item["is_expired"] is True


def test_prazo_de_amanha_nao_esta_vencido(mocker, frozen_clock):
    """Limite superior: prazo futuro segue vigente."""
    item = _read_one(mocker, "29/08/2026")

    assert item["is_expired"] is False


def test_veredito_do_time_fiscal_prevalece_sobre_a_data(mocker, frozen_clock):
    """Coluna H manda: 'Venda Bloqueada' vence mesmo com prazo futuro."""
    item = _read_one(mocker, "29/08/2026", "Vencido - Venda Bloqueada")

    assert item["is_expired"] is True


def test_hoje_vem_do_fuso_de_negocio_e_nao_do_fuso_do_processo(mocker, frozen_clock):
    """Pino direto: o dia usado na comparacao e o de Sao Paulo.

    Se alguem trocar `_today_sp()` de volta por `datetime.now().date()`, este
    teste falha mesmo que o container esteja com `TZ=America/Sao_Paulo` — que e
    justamente o ponto: a correcao nao pode depender da variavel de ambiente.
    """
    assert derivation._today_sp().isoformat() == "2026-08-28"
    assert _FrozenDatetime.now().date().isoformat() == "2026-08-29"
