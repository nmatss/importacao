"""Contrato aditivo do encerramento individual; fontes externas sempre simuladas."""

from contextlib import contextmanager
from datetime import date

import pytest

from app.routes.certificates import _item_restriction
from tests.test_certificates_routes import _ROW, CREATE_URL, _make_item, _mock_certificates_env


@pytest.mark.parametrize(
    "item,cert,expected_status,expected_deadline,pending,origin",
    [
        ({}, {"situacao": "ENCERRADO", "fim_venda": "2030-01-01"}, "ENCERRADO", "2030-01-01", False, "certificado"),
        ({"situacao": None, "fim_venda": None}, {"situacao": "ATIVO"}, "ATIVO", None, False, "certificado"),
        (
            {"situacao": "ENCERRADO", "fim_venda": "2027-01-01"},
            {"situacao": "ATIVO"},
            "ENCERRADO",
            "2027-01-01",
            False,
            "item",
        ),
        ({"situacao": "ENCERRADO"}, {"situacao": "ATIVO"}, "ENCERRADO", None, True, "item"),
        (
            {"situacao": "ENCERRADO"},
            {"situacao": "ENCERRADO", "fim_venda": "2030-01-01"},
            "ENCERRADO",
            "2030-01-01",
            False,
            "item",
        ),
        ({"situacao": "ATIVO"}, {"situacao": "ENCERRADO", "fim_venda": "2030-01-01"}, "ENCERRADO", None, True, "item"),
    ],
)
def test_effective_restriction_resolves_nullable_inheritance(
    item, cert, expected_status, expected_deadline, pending, origin
):
    assert _item_restriction(item, cert) == {
        "situacao_efetiva": expected_status,
        "fim_venda_efetivo": expected_deadline,
        "restricao_pendente": pending,
        "restricao_origem": origin,
    }


def _restriction_env(mocker, old, updated=None, *, cert=None, conflict=False):
    mocker.patch("app.routes.certificates._load_certificate", return_value=cert or _ROW)
    linx = mocker.patch("app.routes.certificates.write_certificate_to_linx")
    cur = mocker.MagicMock()
    responses = [cert or _ROW, old]
    cur.fetchall.return_value = [{"sku": "A", "numero": "other"}] if conflict else []
    if updated is not None:
        responses.append(updated)
    cur.fetchone.side_effect = responses

    @contextmanager
    def database():
        yield mocker.MagicMock(), cur

    mocker.patch("app.routes.certificates.db", database)
    return cur, linx


@pytest.mark.asyncio
async def test_close_one_item_audits_change_without_touching_certificate_or_linx(test_client, api_key_headers, mocker):
    old = _make_item("A", situacao=None, fim_venda=None)
    updated = {**old, "situacao": "ENCERRADO", "fim_venda": date(2027, 1, 1), "linx_status": "pending"}
    cur, linx = _restriction_env(mocker, old, updated)
    response = await test_client.patch(
        f"{CREATE_URL}/{_ROW['id']}/items/A/restriction",
        headers=api_key_headers,
        json={"situacao": "ENCERRADO", "fim_venda": "2027-01-01", "motivo": "Prazo aprovado para item"},
    )
    assert response.status_code == 200
    item = response.json()
    assert item["situacao_efetiva"] == "ENCERRADO"
    assert item["fim_venda_efetivo"] == "2027-01-01"
    assert item["removed_at"] is None
    linx.assert_not_called()
    event = next(
        c for c in cur.execute.call_args_list if "INSERT INTO cert_certificate_item_restriction_events" in c.args[0]
    )
    assert event.args[1][0] == old["id"]
    assert event.args[1][3] == "Prazo aprovado para item"
    summary = next(c for c in cur.execute.call_args_list if "UPDATE cert_certificates " in c.args[0])
    assert "linx_status='pending'" in summary.args[0]
    assert "SET situacao" not in summary.args[0]


@pytest.mark.asyncio
async def test_restore_inheritance_preserves_parent_deadline(test_client, api_key_headers, mocker):
    cert = {**_ROW, "situacao": "ENCERRADO", "fim_venda": "2030-01-01"}
    old = _make_item("A", situacao="ENCERRADO", fim_venda=date(2027, 1, 1))
    updated = {**old, "situacao": None, "fim_venda": None}
    _, linx = _restriction_env(mocker, old, updated, cert=cert)
    response = await test_client.patch(
        f"{CREATE_URL}/{_ROW['id']}/items/A/restriction",
        headers=api_key_headers,
        json={"situacao": None, "fim_venda": None, "motivo": "Restaurar regra aprovada do certificado"},
    )
    assert response.status_code == 200
    assert response.json()["restricao_origem"] == "certificado"
    assert response.json()["fim_venda_efetivo"] == "2030-01-01"
    linx.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload,status",
    [
        ({"situacao": "ATIVO", "fim_venda": "2027-01-01", "motivo": "Ativacao"}, 400),
        ({"situacao": "ENCERRADO", "fim_venda": "1900-01-01", "motivo": "Encerramento"}, 400),
        ({"situacao": "ENCERRADO", "fim_venda": None, "motivo": "   "}, 400),
        ({"situacao": "ENCERRADO", "fim_venda": None}, 422),
    ],
)
async def test_invalid_restriction_is_rejected_before_mutation(test_client, api_key_headers, mocker, payload, status):
    cur, linx = _restriction_env(mocker, _make_item("A"))
    response = await test_client.patch(
        f"{CREATE_URL}/{_ROW['id']}/items/A/restriction", headers=api_key_headers, json=payload
    )
    assert response.status_code == status
    cur.execute.assert_not_called()
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_reactivation_checks_other_active_certificates(test_client, api_key_headers, mocker):
    cur, linx = _restriction_env(mocker, _make_item("A", situacao="ENCERRADO"), conflict=True)
    response = await test_client.patch(
        f"{CREATE_URL}/{_ROW['id']}/items/A/restriction",
        headers=api_key_headers,
        json={"situacao": "ATIVO", "fim_venda": None, "motivo": "Reativar"},
    )
    assert response.status_code == 409
    assert not any(c.args[0].lstrip().startswith("UPDATE") for c in cur.execute.call_args_list)
    linx.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status_,deadline,expected_call", [("ENCERRADO", "2027-01-01", True), ("ENCERRADO", None, False)]
)
async def test_retry_uses_individual_restriction_and_keeps_unknown_deadline_pending(
    test_client, api_key_headers, mocker, status_, deadline, expected_call
):
    _, linx = _mock_certificates_env(mocker, items=[_make_item("A", situacao=status_, fim_venda=deadline)])
    response = await test_client.post(f"{CREATE_URL}/{_ROW['id']}/retry-linx", headers=api_key_headers)
    assert response.status_code == 200
    if expected_call:
        linx.assert_called_once_with("imaginarium", "A", None, None, fim_venda=deadline, situacao="ENCERRADO")
    else:
        linx.assert_not_called()
        assert response.json()["retry_results"][0]["status"] == "pending"


@pytest.mark.asyncio
async def test_create_closed_certificate_without_sale_date_keeps_items_pending(test_client, api_key_headers, mocker):
    _, linx = _mock_certificates_env(mocker)
    response = await test_client.post(
        CREATE_URL,
        headers=api_key_headers,
        data={
            "skus": "A\nB",
            "brand": "imaginarium",
            "situacao": "ENCERRADO",
            "validade_certificado": "2026-01-01",
        },
    )
    assert response.status_code == 200
    assert response.json()["link_result"]["added"] == ["A", "B"]
    assert all(item["status"] == "pending" for item in response.json()["link_result"]["linx"])
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_restriction_payload_requires_explicit_nullable_fields(test_client, api_key_headers, mocker):
    cur, linx = _restriction_env(mocker, _make_item("A", situacao="ENCERRADO", fim_venda="2027-01-01"))
    response = await test_client.patch(
        f"{CREATE_URL}/{_ROW['id']}/items/A/restriction",
        headers=api_key_headers,
        json={"motivo": "Campo omitido nao pode apagar override"},
    )
    assert response.status_code == 422
    cur.execute.assert_not_called()
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_closed_parent_cannot_be_reactivated_by_item_override(test_client, api_key_headers, mocker):
    cur, linx = _restriction_env(
        mocker, _make_item("A"), cert={**_ROW, "situacao": "ENCERRADO", "fim_venda": "2027-01-01"}
    )
    response = await test_client.patch(
        f"{CREATE_URL}/{_ROW['id']}/items/A/restriction",
        headers=api_key_headers,
        json={"situacao": "ATIVO", "fim_venda": None, "motivo": "Tentativa incoerente"},
    )
    assert response.status_code == 409
    cur.execute.assert_not_called()
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_legacy_active_override_on_closed_parent_never_writes_linx(test_client, api_key_headers, mocker):
    _, linx = _mock_certificates_env(
        mocker,
        row={**_ROW, "situacao": "ENCERRADO", "fim_venda": "2027-01-01"},
        items=[_make_item("A", situacao="ATIVO", fim_venda=None)],
    )
    response = await test_client.post(f"{CREATE_URL}/{_ROW['id']}/retry-linx", headers=api_key_headers)
    assert response.status_code == 200
    assert response.json()["retry_results"][0]["status"] == "pending"
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_repeated_identical_restriction_does_not_duplicate_history(test_client, api_key_headers, mocker):
    old = _make_item("A", situacao="ENCERRADO", fim_venda=date(2027, 1, 1))
    cur, linx = _restriction_env(mocker, old)
    response = await test_client.patch(
        f"{CREATE_URL}/{_ROW['id']}/items/A/restriction",
        headers=api_key_headers,
        json={"situacao": "ENCERRADO", "fim_venda": "2027-01-01", "motivo": "Repeticao de request"},
    )
    assert response.status_code == 200
    assert not any(c.args[0].lstrip().startswith(("INSERT", "UPDATE")) for c in cur.execute.call_args_list)
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_removing_closed_item_preserves_restriction_and_other_item(test_client, api_key_headers, mocker):
    cur, linx = _mock_certificates_env(
        mocker,
        items=[
            _make_item("A", situacao="ENCERRADO", fim_venda="2027-01-01"),
            _make_item("B"),
        ],
    )
    response = await test_client.delete(f"{CREATE_URL}/{_ROW['id']}/items/A", headers=api_key_headers)
    assert response.status_code == 200
    update = next(c for c in cur.execute.call_args_list if c.args[0].startswith("UPDATE cert_certificate_items"))
    assert "removed_at" in update.args[0]
    assert "fim_venda" not in update.args[0]
    assert update.args[1][-1] == "A"
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_retry_old_closed_certificate_never_reapplies_deadline_over_new_active_link(
    test_client, api_key_headers, mocker
):
    _, linx = _mock_certificates_env(
        mocker,
        row={**_ROW, "situacao": "ENCERRADO", "fim_venda": "2026-10-29"},
        items=[_make_item("NEVINHO")],
        other_cert_items={"NEVINHO": "CERT-NOVO-ATIVO"},
    )
    response = await test_client.post(f"{CREATE_URL}/{_ROW['id']}/retry-linx", headers=api_key_headers)
    assert response.status_code == 200
    result = response.json()["retry_results"][0]
    assert result["status"] == "pending"
    assert "prazo historico nao enviado" in result["error"]
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_retry_uses_same_lock_as_linking_and_restriction_update(test_client, api_key_headers, mocker):
    from app.routes import certificates

    @contextmanager
    def occupied(*args):
        yield False

    cur, linx = _mock_certificates_env(mocker, items=[_make_item("A")])
    lock = mocker.patch.object(certificates, "sheet_sync_lock", side_effect=occupied)
    response = await test_client.post(f"{CREATE_URL}/{_ROW['id']}/retry-linx", headers=api_key_headers)
    assert response.status_code == 409
    lock.assert_called_once_with(certificates._CERTIFICATE_LINK_LOCK_KEY)
    linx.assert_not_called()
    cur.execute.assert_not_called()


def test_legacy_active_lookup_excludes_certificates_with_any_link_history(mocker):
    from app.routes.certificates import _other_active_certificates

    cursor = mocker.Mock()
    cursor.fetchall.return_value = [{"sku": "LEGACY", "numero": "CERT-ACTIVE"}]
    result = _other_active_certificates(cursor, _ROW["id"], "imaginarium", ["LEGACY"])
    assert result == {"LEGACY": "CERT-ACTIVE"}
    sql, params = cursor.execute.call_args.args
    assert "UNION" in sql
    assert "NOT EXISTS (SELECT 1 FROM cert_certificate_items history WHERE history.certificate_id = c.id)" in sql
    assert params == [_ROW["id"], ["imaginarium"], ["LEGACY"]] * 2


# ---------------------------------------------------------------------------
# C2 — carga em lote "SKU;data" (pedido da Lilian, 17/09): lista de produtos e
# suas respectivas datas direto pela tela, reaproveitando a restricao por item.
# ---------------------------------------------------------------------------

_BATCH_URL = f"{CREATE_URL}/{_ROW['id']}/items/batch"
_ITEMS_URL = f"{CREATE_URL}/{_ROW['id']}/items"


def _sqls(cur) -> list[str]:
    return [" ".join(str(c.args[0]).split()) for c in cur.execute.call_args_list]


def _writes(cur) -> list[str]:
    return [sql for sql in _sqls(cur) if sql.startswith(("INSERT", "UPDATE", "DELETE"))]


def _batch(linhas, **extra) -> dict:
    return {"linhas": linhas, "motivo": "Encerramento aprovado em 17/09", "encerrar_itens_com_data": True, **extra}


@pytest.mark.asyncio
@pytest.mark.parametrize("colado", ["PI7001Y;30/10/2026", "PI5555Y\t29/10/2026", "PI7001Y, 2026-10-30"])
async def test_plain_sku_list_never_stores_a_date_as_sku(test_client, api_key_headers, mocker, colado):
    """Reproducao: 'PI7001Y;30/10/2026' virava os SKUs 'PI7001Y' e '30/10/2026' (e, com TAB, um SKU so)."""
    cur, linx = _mock_certificates_env(mocker)
    response = await test_client.post(
        _ITEMS_URL, headers=api_key_headers, json={"skus": [colado], "dry_run": False}
    )
    assert response.status_code == 400
    assert "SKU;data" in response.json()["detail"]
    assert _writes(cur) == []
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_create_refuses_dates_pasted_in_the_sku_list(test_client, api_key_headers, mocker):
    cur, linx = _mock_certificates_env(mocker)
    response = await test_client.post(
        CREATE_URL,
        headers=api_key_headers,
        data={"skus": "PI7001Y;30/10/2026", "brand": "imaginarium", "validade_certificado": "2030-01-01"},
    )
    assert response.status_code == 400
    assert "SKU;data" in response.json()["detail"]
    assert _writes(cur) == []
    linx.assert_not_called()


def test_batch_parser_accepts_every_documented_format():
    from app.routes.certificates import _parse_batch_lines

    rows = _parse_batch_lines(
        ["PI5555Y", "", "PI7001Y;30/10/2026", "PI7002Y\t29/10/2026", "PI7003Y, 2026-10-28", "PI7004Y 27/10/2026", "PI7005Y;"]
    )
    assert [(r["linha"], r["sku"], r["fim_venda"], r["status"]) for r in rows] == [
        (1, "PI5555Y", None, "ok"),
        (3, "PI7001Y", "2026-10-30", "ok"),  # linha em branco nao conta, mas a numeracao e a da tela
        (4, "PI7002Y", "2026-10-29", "ok"),
        (5, "PI7003Y", "2026-10-28", "ok"),
        (6, "PI7004Y", "2026-10-27", "ok"),
        (7, "PI7005Y", None, "ok"),
    ]


@pytest.mark.parametrize(
    "linhas,linha,trecho",
    [
        (["PI7001Y;31/02/2026"], 1, "Data invalida"),
        (["PI7001Y;amanha"], 1, "Data invalida"),
        (["PI7001Y;01/01/1900"], 1, "Data invalida"),  # sentinela do Linx nunca e data real
        ([";30/10/2026"], 1, "SKU vazio"),
        (["30/10/2026"], 1, "parece uma data"),
        (["30/10/2026;PI7001Y"], 1, "parece uma data"),
        (["PI7001Y;30/10/2026;extra"], 1, "um produto por linha"),
        (["X" * 101], 1, "100 caracteres"),
        (["PI7001Y;30/10/2026", "PI7001Y;31/10/2026"], 2, "datas diferentes"),
        (["PI7001Y", "PI7001Y;31/10/2026"], 1, "datas diferentes"),
    ],
)
def test_batch_parser_reports_the_error_on_the_line(linhas, linha, trecho):
    from app.routes.certificates import _parse_batch_lines

    rows = _parse_batch_lines(linhas)
    row = next(r for r in rows if r["linha"] == linha)
    assert row["status"] == "erro"
    assert trecho in row["mensagem"]
    assert row["conteudo"] == linhas[linha - 1]


def test_batch_parser_ignores_an_identical_repeated_line():
    from app.routes.certificates import _parse_batch_lines

    rows = _parse_batch_lines(["PI7001Y;30/10/2026", "PI7001Y;2026-10-30"])
    assert [r["status"] for r in rows] == ["ok", "ignorada"]
    assert "linha 1" in rows[1]["mensagem"]


@pytest.mark.asyncio
async def test_batch_dry_run_shows_the_plan_per_line_and_writes_nothing(test_client, api_key_headers, mocker):
    cur, linx = _mock_certificates_env(
        mocker,
        items=[_make_item("JA-ATIVO"), _make_item("JA-ENCERRADO", situacao="ENCERRADO", fim_venda=date(2026, 10, 30))],
    )
    response = await test_client.post(
        _BATCH_URL,
        headers=api_key_headers,
        json=_batch(["JA-ATIVO;29/10/2026", "JA-ENCERRADO;30/10/2026", "NOVO", "NOVO-DATA;2030-01-31", "JA-ATIVO;29/10/2026"]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dry_run"] is True and body["valid"] is True
    assert [(r["linha"], r["sku"], r["acao"], r["status"]) for r in body["linhas"]] == [
        (1, "JA-ATIVO", "encerrar", "ok"),
        (2, "JA-ENCERRADO", "sem_alteracao", "ok"),
        (3, "NOVO", "vincular", "ok"),
        (4, "NOVO-DATA", "vincular_e_encerrar", "ok"),
        (5, "JA-ATIVO", "sem_alteracao", "ignorada"),
    ]
    assert body["resumo"] == {"encerrar": 1, "sem_alteracao": 2, "vincular": 1, "vincular_e_encerrar": 1, "erro": 0}
    assert "29/10/2026" in body["linhas"][0]["mensagem"]
    assert _writes(cur) == []
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_batch_date_without_explicit_closure_is_a_line_error(test_client, api_key_headers, mocker):
    """Item/certificado ATIVO nao tem fim de venda: data sem encerramento confirmado e recusada."""
    cur, linx = _mock_certificates_env(mocker, items=[_make_item("A")])
    response = await test_client.post(
        _BATCH_URL,
        headers=api_key_headers,
        json=_batch(["A;29/10/2026", "B"], encerrar_itens_com_data=False),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["linhas"][0]["status"] == "erro"
    assert "nao possui fim de venda" in body["linhas"][0]["mensagem"]
    assert body["linhas"][1]["status"] == "ok"  # a linha boa aparece, mas nada sera gravado
    assert _writes(cur) == []


@pytest.mark.asyncio
async def test_batch_new_sku_of_another_active_certificate_is_a_line_error(test_client, api_key_headers, mocker):
    cur, _ = _mock_certificates_env(mocker, other_cert_items={"PI6552Y": "8325/2022-BRI-1"})
    response = await test_client.post(_BATCH_URL, headers=api_key_headers, json=_batch(["PI6552Y;29/10/2026"]))
    assert response.status_code == 200
    line = response.json()["linhas"][0]
    assert line["status"] == "erro" and "8325/2022-BRI-1" in line["mensagem"]


@pytest.mark.asyncio
async def test_batch_apply_is_all_or_nothing_on_validation(test_client, api_key_headers, mocker):
    """Uma linha invalida e NADA e gravado — nem as linhas boas."""
    cur, linx = _mock_certificates_env(mocker, items=[_make_item("A")])
    response = await test_client.post(
        _BATCH_URL, headers=api_key_headers, json=_batch(["A;29/10/2026", "B;31/02/2026"], dry_run=False)
    )
    assert response.status_code == 422
    assert "Linha 2" in response.json()["detail"]
    assert _writes(cur) == []
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_batch_apply_closes_linked_items_and_links_new_ones_with_audit(test_client, api_key_headers, mocker):
    item = _make_item("A")
    cur, linx = _mock_certificates_env(mocker, items=[item])
    response = await test_client.post(
        _BATCH_URL,
        headers={**api_key_headers, "X-Cert-Actor-Email": "lilian@grupounico.com"},
        json=_batch(["A;29/10/2026", "NOVO;30/10/2026", "SO-VINCULO"], dry_run=False),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dry_run"] is False
    assert [r["status"] for r in body["linhas"]] == ["aplicado", "aplicado", "aplicado"]
    assert "items" in body

    calls = cur.execute.call_args_list
    update = next(c for c in calls if str(c.args[0]).startswith("UPDATE cert_certificate_items SET situacao"))
    assert update.args[1][:2] == ["ENCERRADO", date(2026, 10, 29)]
    inserts = [c for c in calls if "INSERT INTO cert_certificate_items" in str(c.args[0])]
    assert [c.args[1][1] for c in inserts] == ["NOVO", "SO-VINCULO"]
    assert "situacao" in str(inserts[0].args[0]) and date(2026, 10, 30) in inserts[0].args[1]
    assert "situacao" not in str(inserts[1].args[0])  # vinculo simples nao depende da migration de restricao
    events = [c for c in calls if "INSERT INTO cert_certificate_item_restriction_events" in str(c.args[0])]
    assert len(events) == 2  # A (encerrado) e NOVO (vinculado ja encerrado); SO-VINCULO nao muda restricao
    assert all(e.args[1][3] == "Encerramento aprovado em 17/09" for e in events)
    assert all(e.args[1][4] == "lilian@grupounico.com" for e in events)
    # Item ja vinculado segue a regra do PATCH: fica pendente, sem chamar o Linx.
    assert [c.args[1] for c in linx.call_args_list] == ["NOVO", "SO-VINCULO"]
    assert linx.call_args_list[0].kwargs == {"fim_venda": "2026-10-30", "situacao": "ENCERRADO"}
    assert linx.call_args_list[1].kwargs == {"fim_venda": None, "situacao": "ATIVO"}


@pytest.mark.asyncio
async def test_batch_apply_reports_sku_missing_in_linx_without_linking_it(test_client, api_key_headers, mocker):
    cur, linx = _mock_certificates_env(mocker)
    linx.side_effect = [
        {"status": "error", "produto_codigo": None, "error": "SKU 'FANTASMA' nao encontrado no Linx", "details": []},
        {"status": "disabled", "produto_codigo": None, "error": "LINX_WRITE_ENABLED=false", "details": []},
    ]
    response = await test_client.post(_BATCH_URL, headers=api_key_headers, json=_batch(["FANTASMA", "B"], dry_run=False))
    assert response.status_code == 200
    lines = response.json()["linhas"]
    assert (lines[0]["status"], lines[1]["status"]) == ("falhou", "aplicado")
    assert "nao encontrado no Linx" in lines[0]["mensagem"]
    inserts = [c for c in cur.execute.call_args_list if "INSERT INTO cert_certificate_items" in str(c.args[0])]
    assert [c.args[1][1] for c in inserts] == ["B"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload,trecho",
    [
        ({"linhas": ["A"], "motivo": "   ", "dry_run": True}, "motivo"),
        ({"linhas": ["", "  "], "motivo": "ok", "dry_run": True}, "ao menos uma linha"),
        ({"linhas": [f"SKU{i}" for i in range(501)], "motivo": "ok", "dry_run": True}, "500"),
        ({"linhas": ["A"], "motivo": "x" * 1001, "dry_run": True}, "1000"),
        ({"linhas": ["A"] + [""] * 2000, "motivo": "ok", "dry_run": True}, "linhas demais"),
    ],
)
async def test_batch_rejects_bad_envelope_before_touching_the_database(
    test_client, api_key_headers, mocker, payload, trecho
):
    cur, linx = _mock_certificates_env(mocker)
    response = await test_client.post(_BATCH_URL, headers=api_key_headers, json=payload)
    assert response.status_code == 400
    assert trecho in response.json()["detail"]
    assert _writes(cur) == []
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_batch_apply_uses_the_shared_link_lock(test_client, api_key_headers, mocker):
    from app.routes import certificates

    @contextmanager
    def occupied(*args):
        yield False

    cur, linx = _mock_certificates_env(mocker, items=[_make_item("A")])
    lock = mocker.patch.object(certificates, "sheet_sync_lock", side_effect=occupied)
    response = await test_client.post(_BATCH_URL, headers=api_key_headers, json=_batch(["A;29/10/2026"], dry_run=False))
    assert response.status_code == 409
    lock.assert_called_once_with(certificates._CERTIFICATE_LINK_LOCK_KEY)
    assert _writes(cur) == []
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_batch_warns_about_a_date_in_the_past(test_client, api_key_headers, mocker):
    _mock_certificates_env(mocker, items=[_make_item("A")])
    response = await test_client.post(_BATCH_URL, headers=api_key_headers, json=_batch(["A;29/10/2020"]))
    line = response.json()["linhas"][0]
    assert line["status"] == "ok" and "passado" in line["aviso"]


@pytest.mark.asyncio
async def test_batch_accepts_exactly_the_payload_the_page_builds(test_client, api_key_headers, mocker):
    """Contrato compartilhado com o vitest (mesmo arquivo lido em CertCadastroPage.test.tsx)."""
    import json
    from pathlib import Path

    payload = json.loads(
        (Path(__file__).parent / "fixtures" / "certificate_create_contract.json").read_text(encoding="utf-8")
    )["lote"]
    _mock_certificates_env(mocker, items=[_make_item("PI5555Y")])
    response = await test_client.post(_BATCH_URL, headers=api_key_headers, json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["valid"] is True
    assert [r["acao"] for r in body["linhas"]] == ["encerrar", "vincular"]
    # O formato da resposta tambem e contrato: a tela le exatamente estas chaves.
    assert set(body) == {"dry_run", "valid", "total_linhas", "resumo", "linhas"}
    assert set(body["linhas"][0]) == {"linha", "conteudo", "sku", "fim_venda", "acao", "status", "mensagem", "aviso"}


@pytest.mark.asyncio
async def test_batch_requires_api_key(test_client):
    response = await test_client.post(_BATCH_URL, json=_batch(["A"]))
    assert response.status_code == 403
