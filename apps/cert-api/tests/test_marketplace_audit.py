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
    description: str | None = None,
    extra_properties: list[dict] | None = None,
) -> dict:
    """Produto no formato da intelligent-search da VTEX."""
    properties = list(extra_properties or [])
    if cert_text is not None:
        properties.append({"name": "Certificação Inmetro", "values": [cert_text]})
    if componentes is not None:
        properties.append({"name": "Componentes", "values": [componentes]})
    return {
        "productId": product_id,
        "productName": name,
        "linkText": link_text,
        **({"description": description} if description is not None else {}),
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


_PIECES_CASES = [None, 60, 300, 499, 500, 501, 1000]


@pytest.mark.parametrize("pieces", _PIECES_CASES)
@pytest.mark.parametrize(
    ("cert_text", "esperado"),
    [
        # K1: o veredito reflete a EVIDENCIA publicada no site.
        ("CE-BRI/ICEPEX-N 01264-25", "OK"),
        ("Registro Inmetro 004512/2024", "OK"),
        ("", "NAO_OK"),
        ("   ", "NAO_OK"),
        ("Produto certificado", "REVISAR"),
        ("Nao possui", "REVISAR"),
        ("Não possui certificação", "REVISAR"),
        ("Isento de certificação", "REVISAR"),
        ("Produto dispensado de certificação compulsória", "REVISAR"),
        ("Não se aplica", "REVISAR"),
    ],
)
def test_verdict_reflects_the_evidence_published_on_the_site(pieces, cert_text, esperado):
    verdict, _reason = ma.classify("Quebra-cabeca", pieces, cert_text)
    assert verdict == esperado


@pytest.mark.parametrize("cert_text", ["", "CE-BRI/ICEPEX-N 01264-25", "Nao possui", "Produto certificado"])
def test_piece_count_never_changes_the_verdict(cert_text):
    """A regra de 500 pecas foi citada na reuniao, mas NAO aprovada.

    Nenhuma contagem pode dispensar (NAO_EXIGE) nem mudar o veredito: o mesmo
    texto de certificacao da o mesmo resultado de 60 a 1000 pecas.
    """
    vereditos = {ma.classify("Quebra-cabeca", p, cert_text)[0] for p in _PIECES_CASES}
    assert len(vereditos) == 1
    assert "NAO_EXIGE" not in vereditos


def test_declared_exemption_wins_over_a_number_in_the_same_text():
    """Dispensa declarada pelo seller nunca vira OK sozinha: e conferencia humana."""
    verdict, reason = ma.classify("Puzzle", 1000, "Não possui - ver processo 004512/2024")
    assert verdict == "REVISAR"
    assert "dispensa" in reason


def test_reason_states_the_evidence_and_keeps_pieces_informative():
    _, ausente = ma.classify("Puzzle", 60, "")
    assert "não preenchida no site" in ausente
    assert "ausente" not in ausente
    assert "60 peças" in ausente
    _, ok = ma.classify("Puzzle", None, "CE-BRI/ICEPEX-N 01264-25")
    assert "autenticidade não verificada" in ok
    assert "não informada" in ok


# --- K3: a evidencia nao mora so na especificacao "Certificacao Inmetro" ------


@pytest.mark.parametrize("spec_name", ["Registro Inmetro", "Inmetro", "Selo INMETRO", "Nº Inmetro"])
def test_any_specification_named_inmetro_counts_as_evidence(spec_name):
    product = _product(
        "Puzzle 100 pecas",
        extra_properties=[{"name": spec_name, "values": ["CE-BRI/ICEPEX-N 01264-25"]}],
    )
    assert "01264-25" in ma.extract_inmetro_text(product)
    assert ma.audit_products([product])[0]["verdict"] == "OK"


def test_specification_whose_value_mentions_inmetro_counts_as_evidence():
    product = _product(
        "Puzzle 100 pecas",
        extra_properties=[
            {"name": "Informações adicionais", "values": ["Certificado Inmetro OCP 0012 registro 004512/2024"]}
        ],
    )
    assert ma.audit_products([product])[0]["verdict"] == "OK"


def test_specification_inside_specification_groups_counts_as_evidence():
    product = _product("Puzzle 100 pecas")
    product["specificationGroups"] = [
        {"specifications": [{"name": "Registro Inmetro", "values": ["004512/2024"]}]}
    ]
    assert ma.audit_products([product])[0]["verdict"] == "OK"


def test_certificate_cited_in_the_description_is_not_reported_as_missing():
    product = _product(
        "Puzzle 100 pecas",
        description=(
            "<p>Quebra-cabeca ilustrado, caixa 30x20 cm.</p>"
            "<p>Produto certificado pelo <b>Inmetro</b>: CE-BRI/ICEPEX-N 01264-25.</p>"
        ),
    )
    row = ma.audit_products([product])[0]
    assert row["verdict"] == "OK"
    assert "01264-25" in row["cert_text"]
    assert "<" not in row["cert_text"]


def test_description_that_mentions_inmetro_without_a_number_goes_to_review():
    product = _product("Puzzle 100 pecas", description="Brinquedo com selo do Inmetro.")
    assert ma.audit_products([product])[0]["verdict"] == "REVISAR"


def test_number_far_from_the_inmetro_mention_does_not_become_ok():
    """So o trecho em volta de "inmetro" e evidencia: um numero solto no fim de
    uma descricao longa (SAC, lote, dimensao) nao pode virar OK."""
    product = _product(
        "Puzzle 100 pecas",
        description="Selo Inmetro na embalagem. " + ("Texto de venda sem relacao. " * 30) + "SAC 0800-2024",
    )
    assert ma.audit_products([product])[0]["verdict"] == "REVISAR"


def test_description_without_any_inmetro_mention_stays_not_ok():
    product = _product("Puzzle 100 pecas", description="Caixa 1234/2024, lote 0800-2024.")
    row = ma.audit_products([product])[0]
    assert row["verdict"] == "NAO_OK"
    assert row["cert_text"] is None


def test_empty_certification_specification_is_not_evidence():
    product = _product("Puzzle 100 pecas", cert_text="  ")
    assert ma.audit_products([product])[0]["verdict"] == "NAO_OK"


def test_evidence_text_is_bounded():
    product = _product("Puzzle 100 pecas", cert_text="Inmetro " + "x" * 5000)
    assert len(ma.extract_inmetro_text(product)) <= ma._MAX_EVIDENCE_CHARS


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
    assert row["verdict"] == "NAO_OK"
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
            _product("Puzzle 500 pecas", product_id="c", cert_text="CE-BRI/ICEPEX-N 01264-25"),
            _product("Puzzle 2000 pecas", product_id="d", cert_text="Nao possui"),
        ]
    )
    # 1000 e 2000 pecas NAO viram NAO_EXIGE: ninguem atribui esse veredito sozinho.
    assert ma.summarize(rows) == {"OK": 1, "NAO_OK": 2, "REVISAR": 1, "NAO_EXIGE": 0}


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
    marketplace._running_audits.clear()


# --- K4: `category` vem do usuario e vira path de URL (SSRF / path traversal) --

_BAD_CATEGORIES = [
    "../../admin",
    "a?b=c",
    "a/../b",
    "a/./b",
    "/a",
    "a/",
    "a//b",
    "A/B",
    "a b",
    "a%2e%2e/b",
    "a#frag",
    "a\\b",
    "https://evil.invalid/x",
    "",
]


@pytest.fixture
def audit_route(mocker):
    """Rota de auditoria isolada: sem thread real, sem rate limit entre testes."""
    from app.routes import marketplace

    marketplace._running_audits.clear()
    marketplace.limiter.reset()
    # Troca so a referencia `threading` DESTE modulo: patchar
    # `threading.Thread` global quebra o Timer interno do rate limiter.
    thread = mocker.MagicMock(name="Thread")
    mocker.patch.object(marketplace, "threading", mocker.MagicMock(Thread=thread))
    yield marketplace, thread
    marketplace._running_audits.clear()
    marketplace.limiter.reset()


@pytest.mark.parametrize("category", _BAD_CATEGORIES)
def test_fetch_refuses_a_category_outside_the_allow_list(mocker, category):
    get = mocker.patch.object(ma.requests, "get")
    with pytest.raises(ValueError, match="categoria"):
        ma.fetch_category_products(category, sleep=0)
    get.assert_not_called()


def test_default_category_passes_the_allow_list():
    assert ma.is_valid_category_path(ma.DEFAULT_CATEGORY_PATH)


def test_fetch_never_follows_redirects(mocker):
    """Um 30x do site nao pode levar a leitura para outro host."""
    redirect = mocker.MagicMock(status_code=302, headers={"Location": "http://169.254.169.254/"})
    get = mocker.patch.object(ma.requests, "get", return_value=redirect)

    with pytest.raises(requests.RequestException, match="302"):
        ma.fetch_category_products(sleep=0)

    assert get.call_args.kwargs["allow_redirects"] is False
    assert get.call_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("category", ["../../admin", "a?b=c", "a/../b", "a%2e%2e/b", ""])
async def test_audit_route_rejects_a_forged_category_with_400(
    test_client, api_key_headers, audit_route, category
):
    marketplace, thread = audit_route
    resp = await test_client.post(
        "/api/marketplace/audit", params={"category": category}, headers=api_key_headers
    )
    assert resp.status_code == 400
    thread.assert_not_called()
    assert marketplace._running_audits == {}


@pytest.mark.asyncio
async def test_audit_route_accepts_the_default_and_a_well_formed_category(
    test_client, api_key_headers, audit_route
):
    marketplace, thread = audit_route
    resp = await test_client.post("/api/marketplace/audit", headers=api_key_headers)
    assert resp.status_code == 200
    assert thread.call_args.kwargs["args"][1] == ma.DEFAULT_CATEGORY_PATH

    marketplace._running_audits.clear()
    resp = await test_client.post(
        "/api/marketplace/audit", params={"category": "jogos/quebra-cabeca"}, headers=api_key_headers
    )
    assert resp.status_code == 200
    assert thread.call_args.kwargs["args"][1] == "jogos/quebra-cabeca"
