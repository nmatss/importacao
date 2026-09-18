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
