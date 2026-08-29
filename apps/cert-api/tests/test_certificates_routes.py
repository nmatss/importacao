"""Integration tests for the certificate registration routes (DB and Linx mocked)."""

import pytest

CREATE_URL = "/api/certificates"

_ROW = {
    "id": "11111111-1111-1111-1111-111111111111",
    "sku": "SKU1",
    "brand": "imaginarium",
    "produto_codigo": None,
    "validade_certificado": "2026-12-31",
    "vencimento_licenciamento": None,
    "numero_certificado": None,
    "ocp": None,
    "orgao_certificador": None,
    "pdf_filename": None,
    "linx_status": "disabled",
    "linx_error": "LINX_WRITE_ENABLED=false",
    "linx_detail": [],
    "linx_applied_at": None,
    "created_by": None,
    "created_at": "2026-06-11T00:00:00+00:00",
    "updated_at": "2026-06-11T00:00:00+00:00",
}


def _mock_certificates_env(mocker, row=_ROW, tmp_path=None):
    """Point the certificate routes at a fake DB + Linx so the full path runs.

    Returns:
        Tuple (mock_cursor, mock_linx) for assertions.
    """
    mocker.patch("app.routes.certificates.DATABASE_URL", "postgres://test")
    mocker.patch("app.routes.certificates.is_brand_supported", return_value=True)
    if tmp_path is not None:
        mocker.patch("app.routes.certificates.CERTS_DIR", tmp_path)

    cur = mocker.MagicMock()
    cur.fetchone.return_value = dict(row) if row is not None else None
    cur.fetchall.return_value = [dict(row)] if row is not None else []
    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cur))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.certificates.db", return_value=ctx)

    linx = mocker.patch(
        "app.routes.certificates.write_certificate_to_linx",
        return_value={
            "status": "disabled",
            "error": "LINX_WRITE_ENABLED=false",
            "produto_codigo": None,
            "details": [],
        },
    )
    return cur, linx


@pytest.mark.asyncio
async def test_create_requires_api_key(test_client):
    """POST /api/certificates without X-API-Key must be rejected."""
    resp = await test_client.post(CREATE_URL, data={"sku": "S1", "brand": "puket"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_requires_sku_and_brand(test_client, api_key_headers, mocker):
    """Blank SKU (whitespace only) must return 400, before touching Linx."""
    _, linx = _mock_certificates_env(mocker)
    resp = await test_client.post(
        CREATE_URL,
        data={"sku": "   ", "brand": "puket", "validade_certificado": "2026-12-31"},
        headers=api_key_headers,
    )
    assert resp.status_code == 400
    assert "obrigatorio" in resp.json()["detail"]
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_create_requires_at_least_one_date(test_client, api_key_headers, mocker):
    """Neither date informed must return 400."""
    _, linx = _mock_certificates_env(mocker)
    resp = await test_client.post(
        CREATE_URL, data={"sku": "S1", "brand": "puket"}, headers=api_key_headers
    )
    assert resp.status_code == 400
    assert "ao menos uma data" in resp.json()["detail"]
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_create_rejects_invalid_date_before_database(
    test_client, api_key_headers, mocker
):
    cur, linx = _mock_certificates_env(mocker)
    resp = await test_client.post(
        CREATE_URL,
        data={"sku": "S1", "brand": "puket", "validade_certificado": "31/12/2027"},
        headers=api_key_headers,
    )
    assert resp.status_code == 400
    assert "AAAA-MM-DD" in resp.json()["detail"]
    cur.execute.assert_not_called()
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_create_rejects_brand_without_linx_integration(
    test_client, api_key_headers, mocker
):
    _, linx = _mock_certificates_env(mocker)
    mocker.patch("app.routes.certificates.is_brand_supported", return_value=False)
    resp = await test_client.post(
        CREATE_URL,
        data={"sku": "S1", "brand": "outra", "validade_certificado": "2027-12-31"},
        headers=api_key_headers,
    )
    assert resp.status_code == 400
    assert "integracao Linx" in resp.json()["detail"]
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_create_rejects_non_pdf_extension(test_client, api_key_headers, mocker, tmp_path):
    """An attachment without .pdf extension must be rejected."""
    _mock_certificates_env(mocker, tmp_path=tmp_path)
    resp = await test_client.post(
        CREATE_URL,
        data={"sku": "S1", "brand": "puket", "validade_certificado": "2026-12-31"},
        files={"pdf": ("evil.exe", b"MZ\x90\x00", "application/octet-stream")},
        headers=api_key_headers,
    )
    assert resp.status_code == 400
    assert ".pdf" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_rejects_forged_pdf_content(test_client, api_key_headers, mocker, tmp_path):
    """A .pdf file whose content lacks the %PDF- signature must be rejected."""
    _mock_certificates_env(mocker, tmp_path=tmp_path)
    resp = await test_client.post(
        CREATE_URL,
        data={"sku": "S1", "brand": "puket", "validade_certificado": "2026-12-31"},
        files={"pdf": ("cert.pdf", b"this is not a pdf", "application/pdf")},
        headers=api_key_headers,
    )
    assert resp.status_code == 400
    assert "PDF valido" in resp.json()["detail"]
    assert list(tmp_path.glob("*.pdf")) == []  # nothing persisted


@pytest.mark.asyncio
async def test_create_happy_path_records_linx_outcome(
    test_client, api_key_headers, mocker, tmp_path
):
    """Full create path: saves row, stores the PDF and records the Linx result."""
    cur, linx = _mock_certificates_env(mocker, tmp_path=tmp_path)
    resp = await test_client.post(
        CREATE_URL,
        data={
            "sku": "  SKU1  ",
            "brand": "imaginarium",
            "validade_certificado": "2026-12-31",
        },
        files={"pdf": ("cert.pdf", b"%PDF-1.4 fake body", "application/pdf")},
        headers=api_key_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["sku"] == "SKU1"
    assert body["linx_status"] == "disabled"
    # SKU/brand are trimmed before reaching Linx; record saved even with Linx off
    linx.assert_called_once_with("imaginarium", "SKU1", "2026-12-31", None)
    assert len(list(tmp_path.glob("*.pdf"))) == 1
    executed_sql = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "INSERT INTO cert_certificates" in executed_sql
    assert "UPDATE cert_certificates" in executed_sql


@pytest.mark.asyncio
async def test_create_prefers_gateway_actor_for_audit_attribution(
    test_client, api_key_headers, mocker, tmp_path
):
    """The reverse proxy actor header overrides a spoofable multipart field."""
    cur, _ = _mock_certificates_env(mocker, tmp_path=tmp_path)
    resp = await test_client.post(
        CREATE_URL,
        data={
            "sku": "SKU1",
            "brand": "imaginarium",
            "validade_certificado": "2026-12-31",
            "created_by": "spoofed@grupounico.com",
        },
        headers={**api_key_headers, "X-Cert-Actor-Email": "operadora@grupounico.com"},
    )

    assert resp.status_code == 200
    insert_call = next(
        call for call in cur.execute.call_args_list if "INSERT INTO cert_certificates" in str(call.args[0])
    )
    assert insert_call.args[1][-1] == "operadora@grupounico.com"


@pytest.mark.asyncio
async def test_retry_linx_404_when_not_found(test_client, api_key_headers, mocker):
    """Retry for an unknown certificate id must return 404 without calling Linx."""
    _, linx = _mock_certificates_env(mocker, row=None)
    resp = await test_client.post(
        f"{CREATE_URL}/00000000-0000-0000-0000-000000000000/retry-linx",
        headers=api_key_headers,
    )
    assert resp.status_code == 404
    linx.assert_not_called()


@pytest.mark.asyncio
async def test_retry_linx_reprocesses_saved_certificate(test_client, api_key_headers, mocker):
    """Retry must re-run the Linx write with the stored brand/sku/dates."""
    _, linx = _mock_certificates_env(mocker)
    resp = await test_client.post(
        f"{CREATE_URL}/{_ROW['id']}/retry-linx", headers=api_key_headers
    )
    assert resp.status_code == 200
    linx.assert_called_once_with("imaginarium", "SKU1", "2026-12-31", None)


@pytest.mark.asyncio
async def test_list_certificates_empty_shape_without_db(test_client, api_key_headers):
    """Without a DATABASE_URL the list endpoint returns the empty paginated shape."""
    resp = await test_client.get(CREATE_URL, headers=api_key_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["total_pages"] == 0


@pytest.mark.asyncio
async def test_get_certificate_404_without_db(test_client, api_key_headers):
    """Without a DATABASE_URL a certificate lookup returns 404, not 500."""
    resp = await test_client.get(f"{CREATE_URL}/abc", headers=api_key_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_linx_lookup_returns_read_only_property_values(
    test_client, api_key_headers, mocker
):
    lookup = mocker.patch(
        "app.routes.certificates.read_certificate_from_linx",
        return_value={
            "status": "found",
            "sku": "SKU1",
            "brand": "puket",
            "produto_codigo": "P-1",
            "validade_certificado": "2027-12-31",
            "vencimento_licenciamento": None,
            "properties": {
                "validade_certificado": {
                    "property_code": "00224",
                    "raw_value": "31/12/2027",
                    "state": "found",
                },
                "vencimento_licenciamento": {
                    "property_code": "00225",
                    "raw_value": "01/01/1900",
                    "state": "empty",
                },
            },
        },
    )

    resp = await test_client.get(
        f"{CREATE_URL}/linx-lookup",
        params={"sku": " SKU1 ", "brand": "puket"},
        headers=api_key_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["validade_certificado"] == "2027-12-31"
    lookup.assert_called_once_with("puket", "SKU1")


@pytest.mark.asyncio
async def test_linx_lookup_does_not_expose_connection_error(
    test_client, api_key_headers, mocker
):
    mocker.patch(
        "app.routes.certificates.read_certificate_from_linx",
        side_effect=OSError("Login failed for private-user@private-host"),
    )

    resp = await test_client.get(
        f"{CREATE_URL}/linx-lookup",
        params={"sku": "SKU1", "brand": "imaginarium"},
        headers=api_key_headers,
    )

    assert resp.status_code == 503
    assert resp.json()["detail"] == "Linx indisponivel para consulta"
    assert "private" not in resp.text


@pytest.mark.asyncio
async def test_linx_lookup_returns_404_for_unknown_product(
    test_client, api_key_headers, mocker
):
    mocker.patch(
        "app.routes.certificates.read_certificate_from_linx",
        side_effect=LookupError("SKU nao encontrado no Linx"),
    )
    resp = await test_client.get(
        f"{CREATE_URL}/linx-lookup",
        params={"sku": "UNKNOWN", "brand": "puket"},
        headers=api_key_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Server-side derived-status filtering on GET /api/products (round-1 BLOCKER)
# ---------------------------------------------------------------------------


def _make_product_row(sku: str, **overrides) -> dict:
    """Build a cert_products row dict with sensible defaults for derivation."""
    row = {
        "sku": sku,
        "name": f"Product {sku}",
        "brand": "imaginarium",
        "certification_type": "INMETRO",
        "expected_cert_text": "INMETRO",
        "ecommerce_description": "",
        "sheet_status": "Ativo",
        "is_expired": False,
        "sale_deadline": "2030-01-01",
        "sale_deadline_date": None,
        "last_validation_status": "OK",
        "last_validation_score": None,
        "last_validation_url": None,
        "last_validation_error": None,
        "last_validation_date": None,
        "actual_cert_text": None,
        "created_at": None,
        "updated_at": None,
    }
    row.update(overrides)
    return row


def _mock_products_db(mocker, rows: list[dict]):
    """Point list_products at a fake DB whose SELECT * returns ``rows``.

    The cursor routes fetch results by inspecting the executed SQL:
    - SELECT * FROM cert_products  -> the full candidate set (derived filtering)
    - cert_stock                   -> no stock rows
    - MAX(last_validation_date)    -> a null last date

    Returns:
        The mock cursor for assertions.
    """
    mocker.patch("app.routes.certifications.DATABASE_URL", "postgres://test")
    mocker.patch("app.routes.certifications._safe_license_map", return_value={})

    cur = mocker.MagicMock()
    state = {"last_sql": ""}

    def _execute(sql, params=None):
        state["last_sql"] = str(sql)

    def _fetchall():
        sql = state["last_sql"]
        if "FROM cert_stock" in sql:
            return []
        if "SELECT * FROM cert_products" in sql:
            return [dict(r) for r in rows]
        return []

    def _fetchone():
        sql = state["last_sql"]
        if "COUNT(*)" in sql:
            return {"cnt": len(rows)}
        if "MAX(last_validation_date)" in sql:
            return {"last_date": None}
        return None

    cur.execute.side_effect = _execute
    cur.fetchall.side_effect = _fetchall
    cur.fetchone.side_effect = _fetchone

    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cur))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.certifications.db", return_value=ctx)
    return cur


@pytest.mark.asyncio
async def test_products_cert_status_filter_returns_only_matches(
    test_client, api_key_headers, mocker
):
    """cert_status=ENCERRADO must return only ENCERRADO rows with correct totals.

    5 of 8 rows derive to ENCERRADO; the unfiltered table is larger than a page,
    yet total/total_pages must reflect the FILTERED count, not the raw table.
    """
    rows = []
    # 5 ENCERRADO (expired, out of sale window)
    for i in range(5):
        rows.append(
            _make_product_row(
                f"ENC{i}", sheet_status="Encerrado", is_expired=True, sale_deadline="Vencido"
            )
        )
    # 3 ATIVO (clean active)
    for i in range(3):
        rows.append(_make_product_row(f"ACT{i}"))

    _mock_products_db(mocker, rows)
    resp = await test_client.get(
        "/api/products?cert_status=ENCERRADO&per_page=3", headers=api_key_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert data["total_pages"] == 2  # ceil(5 / 3)
    assert len(data["products"]) == 3  # first page
    assert all(p["cert_status"] == "ENCERRADO" for p in data["products"])


@pytest.mark.asyncio
async def test_products_cert_status_filter_is_case_insensitive(
    test_client, api_key_headers, mocker
):
    """Lower-case filter value must still match the upper-case derived status."""
    rows = [_make_product_row("ACT0"), _make_product_row("ACT1")]
    _mock_products_db(mocker, rows)
    resp = await test_client.get(
        "/api/products?cert_status=ativo", headers=api_key_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert all(p["cert_status"] == "ATIVO" for p in data["products"])


@pytest.mark.asyncio
async def test_products_multi_axis_filter_is_and(test_client, api_key_headers, mocker):
    """cert_status AND site_status applied together narrow to the intersection."""
    rows = [
        # ATIVO + CONFORME (OK on active)
        _make_product_row("A_CONF"),
        # ATIVO + NAO_CONFORME (never validated -> pending phrase)
        _make_product_row("A_NAOCONF", last_validation_status=None),
        # ENCERRADO + NAO_CONFORME (on site, encerrado)
        _make_product_row(
            "ENC_NAOCONF",
            sheet_status="Encerrado",
            is_expired=True,
            sale_deadline="Vencido",
            last_validation_status="OK",
        ),
    ]
    _mock_products_db(mocker, rows)
    resp = await test_client.get(
        "/api/products?cert_status=ATIVO&site_status=CONFORME", headers=api_key_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["products"][0]["sku"] == "A_CONF"
    assert data["products"][0]["cert_status"] == "ATIVO"
    assert data["products"][0]["site_status"] == "CONFORME"


@pytest.mark.asyncio
async def test_products_csv_filter_matches_any_value_in_axis(
    test_client, api_key_headers, mocker
):
    """A comma-separated axis matches rows whose derived status is in the list."""
    rows = [
        _make_product_row("ACT0"),  # ATIVO
        _make_product_row(
            "ENC0", sheet_status="Encerrado", is_expired=True, sale_deadline="Vencido"
        ),  # ENCERRADO
    ]
    _mock_products_db(mocker, rows)
    resp = await test_client.get(
        "/api/products?cert_status=ATIVO,ENCERRADO", headers=api_key_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2


@pytest.mark.asyncio
async def test_products_license_status_filter_uses_license_map(
    test_client, api_key_headers, mocker
):
    """license_status and license_deadline must come from Licenciamentos Vencidos."""
    rows = [_make_product_row("LIC1"), _make_product_row("NO_LIC")]
    _mock_products_db(mocker, rows)
    mocker.patch(
        "app.routes.certifications._safe_license_map",
        return_value={"LIC1": {"status": "VENCIDO", "valid_until": "2025-01-31"}},
    )

    resp = await test_client.get(
        "/api/products?license_status=VENCIDO", headers=api_key_headers
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["products"][0]["sku"] == "LIC1"
    assert data["products"][0]["license_status"] == "VENCIDO"
    assert data["products"][0]["license_deadline"] == "2025-01-31"


@pytest.mark.asyncio
async def test_products_no_derived_filter_uses_sql_count(
    test_client, api_key_headers, mocker
):
    """Without derived filters the route keeps the COUNT(*)-based total."""
    rows = [_make_product_row(f"S{i}") for i in range(2)]
    cur = _mock_products_db(mocker, rows)
    resp = await test_client.get("/api/products", headers=api_key_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    # COUNT(*) path executed when no derived filter is present.
    executed = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "COUNT(*)" in executed


# ---------------------------------------------------------------------------
# MEDIO 9 — comercializacao_status era parametro fantasma
# ---------------------------------------------------------------------------


def _rows_por_comercializacao() -> list[dict]:
    """3 LIBERADA + 2 DENTRO_PRAZO + 1 ENCERRADA."""
    rows = [_make_product_row(f"LIB{i}") for i in range(3)]
    rows += [
        _make_product_row(
            f"PRZ{i}",
            sheet_status="Encerrado",
            is_expired=True,
            sale_deadline="Venda ate o fim do lote",
        )
        for i in range(2)
    ]
    rows.append(
        _make_product_row("ENC0", sheet_status="Encerrado", is_expired=True, sale_deadline="Vencido")
    )
    return rows


@pytest.mark.asyncio
async def test_products_comercializacao_status_filter_is_applied(
    test_client, api_key_headers, mocker
):
    """O parametro era montado pelo cliente e DESCARTADO pelo FastAPI (nao declarado)."""
    _mock_products_db(mocker, _rows_por_comercializacao())
    resp = await test_client.get(
        "/api/products?comercializacao_status=DENTRO_PRAZO", headers=api_key_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert {p["sku"] for p in data["products"]} == {"PRZ0", "PRZ1"}
    assert all(p["comercializacao_status"] == "DENTRO_PRAZO" for p in data["products"])


@pytest.mark.asyncio
async def test_products_comercializacao_status_filter_is_case_insensitive(
    test_client, api_key_headers, mocker
):
    _mock_products_db(mocker, _rows_por_comercializacao())
    resp = await test_client.get(
        "/api/products?comercializacao_status=encerrada", headers=api_key_headers
    )
    assert resp.status_code == 200
    assert [p["sku"] for p in resp.json()["products"]] == ["ENC0"]


@pytest.mark.asyncio
async def test_products_comercializacao_status_combines_with_other_axes(
    test_client, api_key_headers, mocker
):
    """AND entre eixos: ATIVO + LIBERADA exclui os DENTRO_PRAZO (que tambem sao ATIVO)."""
    _mock_products_db(mocker, _rows_por_comercializacao())
    resp = await test_client.get(
        "/api/products?cert_status=ATIVO&comercializacao_status=LIBERADA", headers=api_key_headers
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 3


@pytest.mark.asyncio
async def test_products_empty_comercializacao_status_imposes_no_constraint(
    test_client, api_key_headers, mocker
):
    _mock_products_db(mocker, _rows_por_comercializacao())
    resp = await test_client.get(
        "/api/products?comercializacao_status=", headers=api_key_headers
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 6


# ---------------------------------------------------------------------------
# MEDIO 10 — filtro de marca do cadastro tem de usar a mesma normalizacao
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_certificates_brand_filter_uses_shared_normalization(
    test_client, api_key_headers, mocker
):
    """O slug `puket_escolares` da UI tem de casar com 'Puket Escolares' no banco."""
    cur, _ = _mock_certificates_env(mocker)
    cur.fetchone.return_value = {"cnt": 1}

    resp = await test_client.get(
        "/api/certificates?brand=puket_escolares", headers=api_key_headers
    )
    assert resp.status_code == 200

    executed = [
        (" ".join(str(c.args[0]).split()), c.args[1] if len(c.args) > 1 else None)
        for c in cur.execute.call_args_list
    ]
    counts = [e for e in executed if "COUNT(*)" in e[0]]
    assert counts, "a rota precisa contar antes de paginar"
    assert "LOWER(REPLACE(brand, '_', ' ')) = %s" in counts[0][0]
    assert "LOWER(brand) = LOWER(%s)" not in counts[0][0]
    assert counts[0][1] == ["puket escolares"]
