"""Certificate registration routes — portal form + auto-write to Linx."""

import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import CERTS_DIR, DATABASE_URL
from app.db.postgres import db
from app.services.linx_service import write_certificate_to_linx
from app.utils.logging import log, log_safe

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

_MAX_PDF_BYTES = 15 * 1024 * 1024  # 15 MB


def _serialize(row: dict) -> dict:
    """Serialize a cert_certificates row to JSON-safe types.

    Args:
        row: Raw DB row dict.

    Returns:
        Dict with dates/timestamps converted to ISO strings.
    """
    for f in (
        "validade_certificado",
        "vencimento_licenciamento",
        "linx_applied_at",
        "created_at",
        "updated_at",
    ):
        v = row.get(f)
        if v is not None and hasattr(v, "isoformat"):
            row[f] = v.isoformat()
    return row


def _save_pdf(file: UploadFile, cert_id: str) -> str:
    """Persist an uploaded certificate PDF to CERTS_DIR.

    Args:
        file: The uploaded file.
        cert_id: Certificate UUID, used to name the stored file.

    Returns:
        The stored filename (basename only).

    Raises:
        HTTPException: 400 if the file is not a PDF or exceeds the size limit.
    """
    filename = (file.filename or "").lower()
    if not filename.endswith(".pdf"):
        raise HTTPException(400, "O anexo deve ter extensao .pdf")
    # Reject oversized uploads before reading the whole body into memory when the
    # size is known (Starlette populates UploadFile.size from the multipart parser).
    if getattr(file, "size", None) and file.size > _MAX_PDF_BYTES:
        raise HTTPException(400, "PDF excede o limite de 15 MB")
    data = file.file.read()
    if len(data) > _MAX_PDF_BYTES:
        raise HTTPException(400, "PDF excede o limite de 15 MB")
    # Content sniff: a real PDF starts with the %PDF- signature. Stops a forged
    # Content-Type / renamed binary from being stored as a certificate.
    if not data.startswith(b"%PDF-"):
        raise HTTPException(400, "Arquivo nao e um PDF valido")
    stored = f"{cert_id}.pdf"
    (CERTS_DIR / stored).write_bytes(data)
    return stored


@router.post("/api/certificates")
@limiter.limit("30/minute")
def create_certificate(
    request: Request,
    sku: str = Form(...),
    brand: str = Form(...),
    validade_certificado: str = Form(""),
    vencimento_licenciamento: str = Form(""),
    numero_certificado: str = Form(""),
    ocp: str = Form(""),
    orgao_certificador: str = Form(""),
    created_by: str = Form(""),
    pdf: UploadFile | None = File(None),
) -> dict:
    """Register a new certificate and auto-write its dates to Linx.

    Accepts multipart/form-data (so the certificate PDF can be uploaded). The
    record is always saved in Postgres first; the Linx upsert then runs and its
    outcome is stored on the same row (linx_status / linx_error / linx_detail).

    Returns:
        The created certificate record (serialized), including the Linx result.

    Raises:
        HTTPException: 400 on invalid input, 500 if the database is unavailable.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Banco de dados nao configurado")

    sku = sku.strip()
    brand = brand.strip()
    if not sku or not brand:
        raise HTTPException(400, "SKU e marca sao obrigatorios")
    if not validade_certificado and not vencimento_licenciamento:
        raise HTTPException(
            400, "Informe ao menos uma data (validade do certificado ou vencimento do licenciamento)"
        )

    cert_id = str(uuid.uuid4())
    pdf_filename = _save_pdf(pdf, cert_id) if pdf is not None and pdf.filename else None

    with db() as (conn, cur):
        cur.execute(
            """
            INSERT INTO cert_certificates
                (id, sku, brand, validade_certificado, vencimento_licenciamento,
                 numero_certificado, ocp, orgao_certificador, pdf_filename,
                 linx_status, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s)
            """,
            [
                cert_id, sku, brand,
                validade_certificado or None, vencimento_licenciamento or None,
                numero_certificado or None, ocp or None, orgao_certificador or None,
                pdf_filename, created_by or None,
            ],
        )

    linx = write_certificate_to_linx(
        brand, sku, validade_certificado or None, vencimento_licenciamento or None
    )
    applied_at = datetime.now(UTC) if linx["status"] == "applied" else None

    with db() as (conn, cur):
        cur.execute(
            """
            UPDATE cert_certificates
            SET produto_codigo=%s, linx_status=%s, linx_error=%s,
                linx_detail=%s, linx_applied_at=%s, updated_at=NOW()
            WHERE id=%s
            """,
            [
                linx.get("produto_codigo"), linx["status"], linx.get("error"),
                json.dumps(linx.get("details", [])), applied_at, cert_id,
            ],
        )
        cur.execute("SELECT * FROM cert_certificates WHERE id=%s", [cert_id])
        row = _serialize(dict(cur.fetchone()))

    log.info(
        f"Certificate {cert_id} saved (sku={log_safe(sku)}, brand={log_safe(brand)}, "
        f"linx={linx['status']})"
    )
    return row


@router.get("/api/certificates")
def list_certificates(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    sku: str = Query(""),
    brand: str = Query(""),
    linx_status: str = Query(""),
) -> dict:
    """List registered certificates with optional filters.

    Returns:
        Paginated dict with items, total, page, per_page, total_pages.
    """
    if not DATABASE_URL:
        return {"items": [], "total": 0, "page": 1, "per_page": per_page, "total_pages": 0}

    conditions: list[str] = []
    params: list = []
    if sku:
        conditions.append("sku ILIKE %s")
        params.append(f"%{sku}%")
    if brand:
        conditions.append("LOWER(brand) = LOWER(%s)")
        params.append(brand)
    if linx_status:
        conditions.append("linx_status = %s")
        params.append(linx_status)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with db() as (conn, cur):
        cur.execute(f"SELECT COUNT(*) AS cnt FROM cert_certificates {where}", params)
        total = cur.fetchone()["cnt"]
        offset = (page - 1) * per_page
        cur.execute(
            f"SELECT * FROM cert_certificates {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize(dict(r)) for r in cur.fetchall()]

    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": max(1, (total + per_page - 1) // per_page),
    }


@router.get("/api/certificates/{cert_id}")
def get_certificate(cert_id: str) -> dict:
    """Get a single certificate by id.

    Raises:
        HTTPException: 404 if not found.
    """
    if not DATABASE_URL:
        raise HTTPException(404, "Certificado nao encontrado")
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_certificates WHERE id=%s", [cert_id])
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Certificado nao encontrado")
        return _serialize(dict(row))


@router.get("/api/certificates/{cert_id}/pdf")
def download_certificate_pdf(cert_id: str) -> FileResponse:
    """Download the PDF attached to a certificate.

    Raises:
        HTTPException: 404 if the certificate or its PDF is missing.
    """
    if not DATABASE_URL:
        raise HTTPException(404, "Certificado nao encontrado")
    with db() as (conn, cur):
        cur.execute("SELECT pdf_filename FROM cert_certificates WHERE id=%s", [cert_id])
        row = cur.fetchone()
    if not row or not row["pdf_filename"]:
        raise HTTPException(404, "PDF nao encontrado para este certificado")
    path = CERTS_DIR / row["pdf_filename"]
    if not path.exists():
        raise HTTPException(404, "Arquivo PDF nao encontrado no servidor")
    return FileResponse(str(path), media_type="application/pdf", filename=row["pdf_filename"])


@router.post("/api/certificates/{cert_id}/retry-linx")
@limiter.limit("30/minute")
def retry_linx(request: Request, cert_id: str) -> dict:
    """Retry the Linx upsert for a previously saved certificate.

    Useful after enabling LINX_WRITE_ENABLED or fixing the schema config.

    Raises:
        HTTPException: 404 if not found, 500 if DB unavailable.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Banco de dados nao configurado")
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_certificates WHERE id=%s", [cert_id])
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Certificado nao encontrado")
        cert = dict(row)

    linx = write_certificate_to_linx(
        cert["brand"], cert["sku"],
        cert.get("validade_certificado"), cert.get("vencimento_licenciamento"),
    )
    applied_at = datetime.now(UTC) if linx["status"] == "applied" else None

    with db() as (conn, cur):
        cur.execute(
            """
            UPDATE cert_certificates
            SET produto_codigo=%s, linx_status=%s, linx_error=%s,
                linx_detail=%s, linx_applied_at=%s, updated_at=NOW()
            WHERE id=%s
            """,
            [
                linx.get("produto_codigo"), linx["status"], linx.get("error"),
                json.dumps(linx.get("details", [])), applied_at, cert_id,
            ],
        )
        cur.execute("SELECT * FROM cert_certificates WHERE id=%s", [cert_id])
        return _serialize(dict(cur.fetchone()))
