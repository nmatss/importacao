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
        # K10: so o numero IMEDIATAMENTE antes da unidade conta.
        ("Puzzle 2 em 1 500 peças", 500),
        ("Panorama 2 1000 peças", 1000),
        ("Kit 3 puzzles 100 peças", 100),
        ("Mapa do Brasil em 500 peças", 500),
        ("Quebra-cabeca 500 pçs", 500),
        ("Quebra-cabeca 500 pcs", 500),
        ("Quebra-cabeca 500PCS", 500),
        ("Quebra-cabeca 10.000 peças", 10000),
        ("Quebra-cabeca 10 000 peças", 10000),
        ("Puzzle 1 peça gigante", 1),
        ("Puzzle 3D 216 Peças", 216),
        # Numero absurdo nao pode estourar a coluna INTEGER e derrubar a gravacao.
        ("Puzzle 99999999999 peças", None),
        ("Puzzle 0 peças", None),
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
    mocker.patch.object(ma.time, "sleep")
    ok = mocker.MagicMock(
        status_code=200, **{"json.return_value": {"products": [{"productId": "x"}] * 2}}
    )
    falha = requests.RequestException("timeout")
    get = mocker.patch.object(ma.requests, "get", side_effect=[ok, falha, falha, falha])

    with pytest.raises(requests.RequestException):
        ma.fetch_category_products(page_size=2, max_pages=5, sleep=0)

    # 1 leitura boa + 3 tentativas da pagina seguinte (K6); nada parcial volta.
    assert get.call_count == 4


def test_fetch_propagates_a_failure_on_the_first_page(mocker):
    """Falhar na primeira pagina e "nao consegui ler", nao "categoria vazia"."""
    mocker.patch.object(ma.time, "sleep")
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


# --- K5: um item malformado nao derruba o lote -------------------------------


def test_fractional_stock_string_is_read_as_a_number():
    """`AvailableQuantity="3.0"` derrubava o lote inteiro com ValueError."""
    product = _product("Puzzle 60 pecas", available="3.0")
    assert ma.third_party_sellers(product) == [{"id": "lojaparceira", "name": "Loja Parceira"}]


def test_malformed_items_are_counted_and_the_batch_goes_on():
    lixo = _product("Puzzle quebrado", product_id="ruim", available="muitas")
    produtos = [
        _product("Puzzle 60 pecas", product_id="a", cert_text=""),
        None,
        "texto solto",
        lixo,
        _product("Puzzle 500 pecas", product_id="b", cert_text="CE-BRI/ICEPEX-N 01264-25"),
    ]

    rows, unverified = ma.audit_batch(produtos)

    assert unverified == 3
    por_id = {r["vtex_product_id"]: r for r in rows}
    assert por_id["a"]["verdict"] == "NAO_OK"
    assert por_id["b"]["verdict"] == "OK"
    # O item identificavel fica REGISTRADO como nao verificado, nunca como OK/NAO_OK.
    assert por_id["ruim"]["verdict"] == "REVISAR"
    assert "não verificado" in por_id["ruim"]["reason"].lower()
    assert por_id["ruim"]["name"] == "Puzzle quebrado"
    # Sem identificacao nao ha linha gravavel (vtex_product_id e NOT NULL): so conta.
    assert len(rows) == 3


def test_audit_products_keeps_returning_only_the_rows():
    rows = ma.audit_products([None, _product("Puzzle 60 pecas", cert_text="")])
    assert [r["verdict"] for r in rows] == ["NAO_OK"]


def test_run_audit_reports_the_unverified_count(mocker):
    mocker.patch.object(
        ma, "fetch_category_products", return_value=[None, _product("Puzzle 60 pecas", cert_text="")]
    )
    persist = mocker.patch.object(ma, "persist_audit")

    result = ma.run_audit()

    assert result["scanned"] == 2
    assert result["total"] == 1
    assert result["unverified"] == 1
    persist.assert_called_once()


# --- K6: retry limitado por pagina, sem abrir mao do falhar-fechado -----------


def _page(mocker, n: int, status: int = 200):
    return mocker.MagicMock(
        status_code=status, **{"json.return_value": {"products": [{"productId": str(i)} for i in range(n)]}}
    )


@pytest.fixture
def no_backoff(mocker):
    return mocker.patch.object(ma.time, "sleep")


def test_transient_failure_is_retried_and_the_page_is_read(mocker, no_backoff):
    get = mocker.patch.object(
        ma.requests,
        "get",
        side_effect=[requests.Timeout("lento"), _page(mocker, 0, status=503), _page(mocker, 1)],
    )

    produtos = ma.fetch_category_products(page_size=3, sleep=0)

    assert len(produtos) == 1
    assert get.call_count == 3
    # Backoff crescente entre as tentativas da MESMA pagina.
    esperas = [c.args[0] for c in no_backoff.call_args_list]
    assert esperas == [ma._RETRY_BACKOFF_SECONDS, ma._RETRY_BACKOFF_SECONDS * 2]


def test_retry_is_bounded_to_two_new_attempts_per_page(mocker, no_backoff):
    get = mocker.patch.object(ma.requests, "get", side_effect=requests.ConnectionError("fora"))

    with pytest.raises(requests.RequestException):
        ma.fetch_category_products(page_size=3, sleep=0)

    assert get.call_count == 1 + ma._MAX_RETRIES_PER_PAGE == 3


def test_retry_exhausted_on_a_later_page_never_persists_partial_inventory(mocker, no_backoff):
    """Falhar-fechado continua valendo: esgotado o retry, nada e gravado."""
    falha = _page(mocker, 0, status=503)
    get = mocker.patch.object(
        ma.requests, "get", side_effect=[_page(mocker, ma._PAGE_SIZE), falha, falha, falha]
    )
    mocker.patch.object(ma, "VTEX_REQUEST_DELAY", 0)
    persist = mocker.patch.object(ma, "persist_audit")

    with pytest.raises(requests.RequestException, match="503"):
        ma.run_audit()

    persist.assert_not_called()
    assert get.call_count == 4


def test_client_error_is_not_retried(mocker, no_backoff):
    """404/403 nao melhoram com insistencia: falha na primeira."""
    get = mocker.patch.object(ma.requests, "get", return_value=_page(mocker, 0, status=404))

    with pytest.raises(requests.RequestException, match="404"):
        ma.fetch_category_products(page_size=3, sleep=0)

    assert get.call_count == 1
    no_backoff.assert_not_called()


def test_rate_limited_page_is_retried(mocker, no_backoff):
    get = mocker.patch.object(
        ma.requests, "get", side_effect=[_page(mocker, 0, status=429), _page(mocker, 2)]
    )
    assert len(ma.fetch_category_products(page_size=3, sleep=0)) == 2
    assert get.call_count == 2


# --- K7: categoria vazia e ERRO, nao "auditoria concluida" --------------------


def test_run_audit_with_zero_products_is_an_explicit_error(mocker):
    """Categoria renomeada devolve 200 com lista vazia: nada a gravar, e a tela
    continuaria mostrando a execucao antiga como se fosse a ultima."""
    mocker.patch.object(ma, "fetch_category_products", return_value=[])
    persist = mocker.patch.object(ma, "persist_audit")

    with pytest.raises(ma.EmptyCategoryError):
        ma.run_audit()

    persist.assert_not_called()


def test_worker_turns_the_empty_category_into_a_readable_error(mocker):
    from app.routes import marketplace

    marketplace._running_audits.clear()
    marketplace._remember("run-vazio", {"status": "running"})
    mocker.patch.object(marketplace, "run_audit", side_effect=ma.EmptyCategoryError())

    marketplace._run_audit_worker("run-vazio", ma.DEFAULT_CATEGORY_PATH)

    state = marketplace._running_audits.pop("run-vazio")
    assert state["status"] == "error"
    assert state["error"] == "EmptyCategoryError"
    assert "nenhum produto" in state["message"].lower()
    assert "finished_at" in state


def test_worker_never_leaks_the_text_of_an_unexpected_exception(mocker):
    from app.routes import marketplace

    marketplace._running_audits.clear()
    marketplace._remember("run-x", {"status": "running"})
    mocker.patch.object(
        marketplace, "run_audit", side_effect=RuntimeError("postgres://user:senha@host/db")
    )

    marketplace._run_audit_worker("run-x", ma.DEFAULT_CATEGORY_PATH)

    state = marketplace._running_audits.pop("run-x")
    assert state["status"] == "error"
    assert "senha" not in str(state)


def test_worker_reports_scanned_total_and_unverified(mocker):
    from app.routes import marketplace

    marketplace._running_audits.clear()
    marketplace._remember("run-ok", {"status": "running"})
    mocker.patch.object(
        marketplace,
        "run_audit",
        return_value={
            "run_id": "svc-1", "total": 3, "scanned": 40, "unverified": 2,
            "summary": {"OK": 1, "NAO_OK": 1, "REVISAR": 1, "NAO_EXIGE": 0}, "items": [],
        },
    )

    marketplace._run_audit_worker("run-ok", ma.DEFAULT_CATEGORY_PATH)

    state = marketplace._running_audits.pop("run-ok")
    assert state["status"] == "completed"
    assert (state["scanned"], state["total"], state["unverified"]) == (40, 3, 2)


# --- K8: filtro sem resultado nao apaga a data da ultima auditoria -----------


@pytest.mark.asyncio
async def test_empty_filter_still_reports_when_the_run_happened(
    test_client, api_key_headers, mocker
):
    from datetime import UTC, datetime

    from app.routes import marketplace

    mocker.patch.object(marketplace, "DATABASE_URL", "postgres://test")
    cur = mocker.MagicMock()
    state = {"sql": ""}
    quando = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)

    def _execute(sql, params=None):
        state["sql"] = " ".join(str(sql).split())

    def _fetchone():
        if "MAX(checked_at)" in state["sql"]:
            return {"checked_at": quando}
        return {"run_id": "run-1"}

    def _fetchall():
        if "GROUP BY verdict" in state["sql"]:
            return [{"verdict": "NAO_OK", "cnt": 7}]
        return []  # nenhum item "OK" nesta execucao

    cur.execute.side_effect = _execute
    cur.fetchone.side_effect = _fetchone
    cur.fetchall.side_effect = _fetchall
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(mocker.MagicMock(), cur))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch.object(marketplace, "db", return_value=ctx)

    resp = await test_client.get("/api/marketplace/items?verdict=OK", headers=api_key_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["run_id"] == "run-1"
    assert body["summary"] == {"NAO_OK": 7}
    assert body["checked_at"] == quando.isoformat()


# --- K9: single-flight — uma leitura do site por vez -------------------------


@pytest.mark.asyncio
async def test_second_audit_while_one_is_running_gets_409(test_client, api_key_headers, audit_route):
    marketplace, thread = audit_route

    first = await test_client.post("/api/marketplace/audit", headers=api_key_headers)
    second = await test_client.post("/api/marketplace/audit", headers=api_key_headers)

    assert first.status_code == 200
    assert second.status_code == 409
    assert first.json()["run_id"] in second.json()["detail"] or "andamento" in second.json()["detail"]
    # So UMA thread de leitura foi criada.
    assert thread.call_count == 1
    assert len(marketplace._running_audits) == 1


@pytest.mark.asyncio
async def test_new_audit_is_accepted_after_the_previous_one_finished(
    test_client, api_key_headers, audit_route
):
    marketplace, thread = audit_route
    first = await test_client.post("/api/marketplace/audit", headers=api_key_headers)
    marketplace._running_audits[first.json()["run_id"]]["status"] = "completed"

    second = await test_client.post("/api/marketplace/audit", headers=api_key_headers)

    assert second.status_code == 200
    assert thread.call_count == 2


@pytest.mark.asyncio
async def test_failed_audit_does_not_block_the_next_one(test_client, api_key_headers, audit_route):
    marketplace, _thread = audit_route
    first = await test_client.post("/api/marketplace/audit", headers=api_key_headers)
    marketplace._running_audits[first.json()["run_id"]]["status"] = "error"

    assert (await test_client.post("/api/marketplace/audit", headers=api_key_headers)).status_code == 200


@pytest.mark.asyncio
async def test_wedged_run_stops_blocking_after_the_stale_cutoff(
    test_client, api_key_headers, audit_route
):
    """Thread que nunca finalizou nao pode travar a auditoria para sempre."""
    import time as _time

    marketplace, _thread = audit_route
    marketplace._remember(
        "run-travado",
        {"status": "running", "started_at": _time.time() - marketplace._STALE_RUN_SECONDS - 1},
    )

    resp = await test_client.post("/api/marketplace/audit", headers=api_key_headers)

    assert resp.status_code == 200
    assert marketplace._running_audits["run-travado"]["status"] == "error"


@pytest.mark.asyncio
async def test_thread_that_fails_to_start_releases_the_slot(test_client, api_key_headers, audit_route):
    marketplace, thread = audit_route
    thread.return_value.start.side_effect = RuntimeError("can't start new thread")

    resp = await test_client.post("/api/marketplace/audit", headers=api_key_headers)
    assert resp.status_code == 503

    thread.return_value.start.side_effect = None
    assert (await test_client.post("/api/marketplace/audit", headers=api_key_headers)).status_code == 200


# --- K10: codigo morto removido ----------------------------------------------


def test_dead_threshold_and_accessory_list_are_gone():
    """O `threshold` nunca decidiu nada e a lista de acessorios nao tinha uso:
    mante-los sugeria uma regra de 500 pecas que nao existe."""
    import inspect

    assert not hasattr(ma, "_ACCESSORY_RE")
    assert not hasattr(ma, "DEFAULT_PIECES_THRESHOLD")
    for func in (ma.classify, ma.audit_products, ma.audit_batch, ma.run_audit):
        assert "threshold" not in inspect.signature(func).parameters


@pytest.mark.asyncio
async def test_legacy_threshold_query_param_is_ignored_not_rejected(
    test_client, api_key_headers, audit_route
):
    _marketplace, thread = audit_route
    resp = await test_client.post(
        "/api/marketplace/audit", params={"threshold": 1}, headers=api_key_headers
    )
    assert resp.status_code == 200
    assert len(thread.call_args.kwargs["args"]) == 2
