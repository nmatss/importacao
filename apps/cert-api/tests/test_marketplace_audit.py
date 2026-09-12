"""Auditoria de quebra-cabecas de marketplace (CFN-10 / reuniao 11/09, item 6).

As fixtures reproduzem a ESTRUTURA da resposta publica da intelligent-search da
loja Imaginarium (properties, items[].sellers[].commertialOffer), com nomes e
codigos sinteticos — nenhum documento ou dado real de fornecedor entra no repo.
"""

import pytest
import requests

from app.services import marketplace_audit as ma


def _product(
    name: str,
    *,
    product_id: str = "p1",
    cert_text: str | None = None,
    seller_id: str = "lojaparceira",
    seller_name: str = "Loja Parceira",
    available: int = 5,
    componentes: str | None = None,
    link_text: str = "puzzle-teste",
) -> dict:
    """Produto no formato da intelligent-search da VTEX."""
    properties = []
    if cert_text is not None:
        properties.append({"name": "Certificação Inmetro", "values": [cert_text]})
    if componentes is not None:
        properties.append({"name": "Componentes", "values": [componentes]})
    return {
        "productId": product_id,
        "productName": name,
        "linkText": link_text,
        "properties": properties,
        "items": [
            {
                "sellers": [
                    {
                        "sellerId": seller_id,
                        "sellerName": seller_name,
                        "commertialOffer": {"AvailableQuantity": available},
                    }
                ]
            }
        ],
    }


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("Puzzle 60 pecas Aventura", 60),
        ("Puzzle 350 peças Panorama", 350),
        ("Quebra-cabeca 1.000 peças", 1000),
        ("Quebra-cabeca 2 000 peças", 2000),
        ("Porta-Puzzle", None),
        ("", None),
    ],
)
def test_parse_pieces(texto, esperado):
    assert ma.parse_pieces(texto) == esperado


def test_pieces_fall_back_to_the_componentes_spec():
    """Nome sem contagem nao vira REVISAR quando a especificacao tem o numero."""
    product = _product("Quebra-cabeca Panoramico", componentes="500 peças + poster")
    assert ma.extract_pieces(product) == 500


@pytest.mark.parametrize("pieces", [None, 60, 300, 499, 500, 501, 1000])
@pytest.mark.parametrize("cert_text", ["", "CE-BRI/ICEPEX-N 01264-25", "Nao possui", "Produto certificado"])
def test_applicability_requires_area_validation(pieces, cert_text):
    verdict, reason = ma.classify("Quebra-cabeca", pieces, cert_text)
    assert verdict == "REVISAR"
    assert "Aplicabilidade pendente" in reason
    if cert_text == "":
        assert "ausente" in reason
    elif cert_text.startswith("CE-"):
        assert "autenticidade nao verificada" in reason


def test_legacy_threshold_does_not_approve_a_regulatory_rule():
    assert ma.classify("Puzzle 500 pecas", 500, "", threshold=501)[0] == "REVISAR"
    assert ma.classify("Puzzle 500 pecas", 500, "", threshold=500)[0] == "REVISAR"


def test_house_only_product_is_out_of_scope():
    """Item vendido so pela propria loja ja e coberto pelo painel da planilha."""
    product = _product("Puzzle 60 pecas", seller_id=ma.HOUSE_SELLER_ID, seller_name="imaginarium")
    assert ma.third_party_sellers(product) == []
    assert ma.audit_products([product]) == []


def test_out_of_stock_third_party_seller_is_ignored():
    product = _product("Puzzle 60 pecas", available=0)
    assert ma.third_party_sellers(product) == []


def test_audit_products_builds_the_row_for_persistence():
    rows = ma.audit_products([_product("Puzzle 60 pecas Aventura", cert_text="")])
    assert len(rows) == 1
    row = rows[0]
    assert row["verdict"] == "REVISAR"
    assert row["pieces"] == 60
    assert row["seller_id"] == "lojaparceira"
    assert row["url"].startswith("https://")
    assert row["url"].endswith("/puzzle-teste/p")
    assert row["cert_text"] is None


def test_summarize_always_has_the_four_verdicts():
    rows = ma.audit_products(
        [
            _product("Puzzle 60 pecas", product_id="a", cert_text=""),
            _product("Puzzle 1000 pecas", product_id="b", cert_text=""),
        ]
    )
    assert ma.summarize(rows) == {"OK": 0, "NAO_OK": 0, "REVISAR": 2, "NAO_EXIGE": 0}


def test_fetch_stops_when_a_page_returns_less_than_the_page_size(mocker):
    """A API nao devolve total confiavel: a parada e pela pagina incompleta."""
    respostas = [
        mocker.MagicMock(status_code=200, **{"json.return_value": {"products": [{"productId": str(i)} for i in range(3)]}}),
        mocker.MagicMock(status_code=200, **{"json.return_value": {"products": [{"productId": "x"}]}}),
    ]
    get = mocker.patch.object(ma.requests, "get", side_effect=respostas)

    produtos = ma.fetch_category_products(page_size=3, sleep=0)

    assert len(produtos) == 4
    assert get.call_count == 2


def test_fetch_respects_the_page_ceiling(mocker):
    """Categoria maior que o esperado nao pode virar request infinito."""
    full = mocker.MagicMock(
        status_code=200, **{"json.return_value": {"products": [{"productId": "x"}] * 2}}
    )
    get = mocker.patch.object(ma.requests, "get", return_value=full)

    with pytest.raises(requests.RequestException, match="teto"):
        ma.fetch_category_products(page_size=2, max_pages=3, sleep=0)

    assert get.call_count == 3


def test_fetch_rejects_partial_inventory_when_a_later_page_fails(mocker):
    ok = mocker.MagicMock(
        status_code=200, **{"json.return_value": {"products": [{"productId": "x"}] * 2}}
    )
    get = mocker.patch.object(
        ma.requests, "get", side_effect=[ok, requests.RequestException("timeout")]
    )

    with pytest.raises(requests.RequestException):
        ma.fetch_category_products(page_size=2, max_pages=5, sleep=0)

    assert get.call_count == 2


def test_fetch_propagates_a_failure_on_the_first_page(mocker):
    """Falhar na primeira pagina e "nao consegui ler", nao "categoria vazia"."""
    mocker.patch.object(ma.requests, "get", side_effect=requests.RequestException("dns"))
    with pytest.raises(requests.RequestException):
        ma.fetch_category_products(sleep=0)


def test_persist_writes_one_row_per_item_with_the_run_id(mocker):
    cur = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(mocker.MagicMock(), cur))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch.object(ma, "db", return_value=ctx)

    rows = ma.audit_products(
        [
            _product("Puzzle 60 pecas", product_id="a", cert_text=""),
            _product("Puzzle 1000 pecas", product_id="b", cert_text=""),
        ]
    )
    assert ma.persist_audit(rows, "run-1") == 2
    assert cur.execute.call_count == 2
    assert all(c.args[1][-1] == "run-1" for c in cur.execute.call_args_list)


def test_persist_noop_on_empty(mocker):
    db_mock = mocker.patch.object(ma, "db")
    assert ma.persist_audit([], "run-1") == 0
    db_mock.assert_not_called()


@pytest.mark.asyncio
async def test_marketplace_items_empty_shape_without_db(test_client, api_key_headers):
    resp = await test_client.get("/api/marketplace/items", headers=api_key_headers)
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_marketplace_audit_status_404_for_unknown_run(test_client, api_key_headers):
    resp = await test_client.get("/api/marketplace/audit/desconhecido", headers=api_key_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_marketplace_items_summary_covers_the_whole_run(
    test_client, api_key_headers, mocker
):
    """Com filtro por veredito, o resumo nao pode contar so as linhas filtradas."""
    from app.routes import marketplace

    mocker.patch.object(marketplace, "DATABASE_URL", "postgres://test")
    cur = mocker.MagicMock()
    state = {"sql": ""}

    def _execute(sql, params=None):
        state["sql"] = " ".join(str(sql).split())

    def _fetchall():
        if "GROUP BY verdict" in state["sql"]:
            return [{"verdict": "NAO_OK", "cnt": 2}, {"verdict": "NAO_EXIGE", "cnt": 108}]
        return [
            {
                "id": "33333333-3333-3333-3333-333333333333",
                "vtex_product_id": "a",
                "seller_id": "lojaparceira",
                "seller_name": "Loja Parceira",
                "name": "Puzzle 60 pecas",
                "url": "https://example.invalid/p",
                "pieces": 60,
                "cert_text": None,
                "verdict": "NAO_OK",
                "reason": "60 pecas",
                "checked_at": None,
                "run_id": "run-1",
            }
        ]

    cur.execute.side_effect = _execute
    cur.fetchall.side_effect = _fetchall
    cur.fetchone.side_effect = lambda: {"run_id": "run-1"}
    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cur))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch.object(marketplace, "db", return_value=ctx)

    resp = await test_client.get(
        "/api/marketplace/items?verdict=NAO_OK", headers=api_key_headers
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"] == "run-1"
    assert body["summary"] == {"NAO_OK": 2, "NAO_EXIGE": 108}
    assert len(body["items"]) == 1


def test_audit_run_keeps_memory_bounded(mocker):
    """O dicionario de runs em memoria nao pode crescer sem limite."""
    from app.routes import marketplace

    marketplace._running_audits.clear()
    for i in range(marketplace._MAX_TRACKED_AUDITS + 5):
        marketplace._remember(f"run-{i}", {"status": "completed"})
    assert len(marketplace._running_audits) == marketplace._MAX_TRACKED_AUDITS
    assert "run-0" not in marketplace._running_audits
