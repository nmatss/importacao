"""Testes de GET /api/stats.

Dois defeitos que a tela do Dashboard mostrava como fato consumado:

BLOQUEADOR 2 — o `except Exception: return zeros` transformava um PostgreSQL
fora do ar em "sistema saudavel e vazio" (0 nos quatro cartoes, "Todos os
produtos estao em conformidade") e tornava o ramo vermelho do semaforo
"Google Sheets" inalcancavel. "Vazio" nunca pode ser apresentado como
"indisponivel".

ALTO 3 — `not_found` incluia `last_validation_status IS NULL`, que significa
"nunca validado", nao "nao encontrado": produto recem-importado da planilha
recebia veredito NEGATIVO de conformidade num cartao, numa fatia da pizza e numa
barra do grafico por marca.
"""

import pytest

BY_BRAND_ROWS = [
    {"brand": "imaginarium", "ok": 10, "inconsistent": 2, "not_found": 3, "never_validated": 5, "expired": 1},
    {"brand": "puket", "ok": 4, "inconsistent": 0, "not_found": 0, "never_validated": 7, "expired": 0},
]


def _mock_stats_db(mocker, by_brand=None, fail=False):
    """Aponta /api/stats para um banco falso; `fail=True` simula queda do Postgres.

    Returns:
        Lista das queries executadas (normalizadas em uma linha).
    """
    mocker.patch("app.routes.certifications.DATABASE_URL", "postgres://test")

    if fail:
        mocker.patch(
            "app.routes.certifications.db",
            side_effect=RuntimeError("could not connect to server"),
        )
        return []

    executed: list[str] = []
    cur = mocker.MagicMock()

    def _execute(sql, params=None):
        executed.append(" ".join(str(sql).split()))

    def _fetchone():
        sql = executed[-1]
        if "COUNT(*) as cnt FROM cert_products WHERE is_expired" in sql:
            return {"cnt": 1}
        if "COUNT(*) as cnt FROM cert_products" in sql:
            return {"cnt": 31}
        if "cert_validation_runs" in sql:
            return None
        return None

    def _fetchall():
        return [dict(r) for r in (by_brand if by_brand is not None else BY_BRAND_ROWS)]

    cur.execute.side_effect = _execute
    cur.fetchone.side_effect = _fetchone
    cur.fetchall.side_effect = _fetchall

    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cur))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.certifications.db", return_value=ctx)
    return executed


# ---------------------------------------------------------------------------
# BLOQUEADOR 2
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stats_propaga_falha_do_banco_como_500(test_client, api_key_headers, mocker):
    """Banco fora do ar tem de virar 500 — nunca um dashboard zerado e verde."""
    _mock_stats_db(mocker, fail=True)
    resp = await test_client.get("/api/stats", headers=api_key_headers)
    assert resp.status_code == 500


@pytest.mark.asyncio
async def test_stats_nao_devolve_zeros_quando_o_banco_cai(test_client, api_key_headers, mocker):
    """O payload de erro nao pode ser confundido com 'nao ha produtos'."""
    _mock_stats_db(mocker, fail=True)
    resp = await test_client.get("/api/stats", headers=api_key_headers)
    body = resp.json()
    assert body.get("total_products") != 0
    assert "by_brand" not in body


@pytest.mark.asyncio
async def test_stats_nao_vaza_a_mensagem_da_excecao(test_client, api_key_headers, mocker):
    """A causa vai para o log; a resposta publica fica generica."""
    _mock_stats_db(mocker, fail=True)
    resp = await test_client.get("/api/stats", headers=api_key_headers)
    assert "could not connect to server" not in resp.text


@pytest.mark.asyncio
async def test_stats_sem_banco_configurado_continua_devolvendo_o_shape_vazio(
    test_client, api_key_headers
):
    """DATABASE_URL vazio e configuracao ausente, nao falha — segue 200."""
    resp = await test_client.get("/api/stats", headers=api_key_headers)
    assert resp.status_code == 200
    assert resp.json()["by_brand"] == []


# ---------------------------------------------------------------------------
# ALTO 3
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stats_separa_never_validated_de_not_found(test_client, api_key_headers, mocker):
    executed = _mock_stats_db(mocker)
    resp = await test_client.get("/api/stats", headers=api_key_headers)
    assert resp.status_code == 200

    brand_sql = next(s for s in executed if "GROUP BY brand" in s)
    # `not_found` so conta quem FOI validado.
    assert "last_validation_status IS NOT NULL AND last_validation_status NOT IN ('OK','INCONSISTENT')" in brand_sql
    # E o nunca-validado ganha bucket proprio.
    assert "COUNT(*) FILTER (WHERE last_validation_status IS NULL) as never_validated" in brand_sql


@pytest.mark.asyncio
async def test_stats_payload_expoe_never_validated_por_marca(
    test_client, api_key_headers, mocker
):
    """Contrato: `not_found` permanece (o frontend le) e `never_validated` e ACRESCENTADO."""
    _mock_stats_db(mocker)
    resp = await test_client.get("/api/stats", headers=api_key_headers)
    by_brand = resp.json()["by_brand"]
    assert [b["brand"] for b in by_brand] == ["imaginarium", "puket"]
    for row in by_brand:
        assert "not_found" in row
        assert "never_validated" in row
    assert by_brand[0]["never_validated"] == 5
    assert by_brand[1]["not_found"] == 0
    assert by_brand[1]["never_validated"] == 7
