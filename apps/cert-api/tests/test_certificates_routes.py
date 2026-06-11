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
