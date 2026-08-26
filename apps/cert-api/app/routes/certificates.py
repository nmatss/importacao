"""Certificate registration routes — portal form + auto-write to Linx."""

import json
import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import CERTS_DIR, DATABASE_URL
from app.db.postgres import db
from app.services.linx_service import (
    is_brand_supported,
    read_certificate_from_linx,
    write_certificate_to_linx,
)
from app.utils.logging import log

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

_MAX_PDF_BYTES = 15 * 1024 * 1024  # 15 MB


def _bounded(value: str, label: str, max_length: int) -> str:
    """Trim and length-check a multipart text field."""
    clean = value.strip()
    if len(clean) > max_length:
        raise HTTPException(400, f"{label} excede {max_length} caracteres")
    return clean


def _iso_date(value: str, label: str) -> str:
    """Validate an optional browser date field before it reaches PostgreSQL/Linx."""
    clean = value.strip()
    if not clean:
        return ""
    try:
        date.fromisoformat(clean)
    except ValueError as exc:
        raise HTTPException(400, f"{label} deve estar no formato AAAA-MM-DD") from exc
    return clean


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

    sku = _bounded(sku, "SKU", 100)
    brand = _bounded(brand, "Marca", 100)
    validade_certificado = _iso_date(validade_certificado, "Validade do certificado")
    vencimento_licenciamento = _iso_date(
        vencimento_licenciamento, "Vencimento do licenciamento"
    )
    numero_certificado = _bounded(numero_certificado, "Numero do certificado", 255)
    ocp = _bounded(ocp, "OCP", 255)
    orgao_certificador = _bounded(orgao_certificador, "Orgao certificador", 255)
    created_by = _bounded(created_by, "Responsavel", 320)
    if not sku or not brand:
        raise HTTPException(400, "SKU e marca sao obrigatorios")
    if not is_brand_supported(brand):
        raise HTTPException(400, "Marca sem integracao Linx configurada")
    if not validade_certificado and not vencimento_licenciamento:
        raise HTTPException(
            400, "Informe ao menos uma data (validade do certificado ou vencimento do licenciamento)"
        )

    # Production traffic reaches this service through Nginx, which overwrites
    # this header from the authenticated Node auth_request response. Prefer it
    # over the client-controlled form field so saved certificates are traceable
    # to the real portal actor.
    gateway_actor = (request.headers.get("X-Cert-Actor-Email") or "").strip()
    effective_created_by = gateway_actor[:320] or created_by or None

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
                pdf_filename, effective_created_by,
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

    # replace inline de CR/LF (anti log-injection) — o CodeQL só reconhece o
    # sanitizador aplicado diretamente na variável, não via helper
    sku_log = sku.replace("\r", " ").replace("\n", " ")
    brand_log = brand.replace("\r", " ").replace("\n", " ")
    log.info(f"Certificate {cert_id} saved (sku={sku_log}, brand={brand_log}, linx={linx['status']})")
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


@router.get("/api/certificates/linx-lookup")
@limiter.limit("60/minute")
def lookup_linx_certificate(
    request: Request,
    sku: str = Query(..., min_length=1, max_length=100),
    brand: str = Query(..., min_length=1, max_length=100),
) -> dict:
    """Read the product certificate properties directly from Linx.

    The endpoint never writes to Linx or PostgreSQL.  It is intentionally
    declared before ``/{cert_id}`` so the static path cannot be consumed by the
    certificate-detail route.

    Raises:
        HTTPException: 400 for an unsupported brand, 404 for an unknown SKU or
            503 when the selected Linx database is unavailable.
    """
    try:
        return read_certificate_from_linx(brand.strip(), sku.strip())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        # SQL Server exceptions can carry host/login details.  Keep the public
        # response generic and log only the exception class plus sanitized input.
        sku_log = sku.replace("\r", " ").replace("\n", " ")
        brand_log = brand.replace("\r", " ").replace("\n", " ")
        log.warning(
            f"Linx certificate lookup failed for sku={sku_log} brand={brand_log} "
            f"type={type(exc).__name__}"
        )
        raise HTTPException(503, "Linx indisponivel para consulta") from exc


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
