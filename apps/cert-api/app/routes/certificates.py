"""Certificate registration routes — portal form + auto-write to Linx.

Desde a reuniao de 11/09/2026 (decisao D11) o certificado e uma ENTIDADE com N
produtos, e nao mais um atributo de um SKU: os SKUs vivem em
`cert_certificate_items`, que permite vinculo em massa e remocao individual com
historico (`removed_at`/`removed_by`).
"""

import json
import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from psycopg2 import errors as pg_errors
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import CERTS_DIR, DATABASE_URL
from app.db.postgres import db
from app.models.schemas import CertificateItemsRequest
from app.services.erp_service import normalize_brand_filter
from app.services.linx_service import (
    is_brand_supported,
    read_certificate_from_linx,
    write_certificate_to_linx,
)
from app.utils.logging import log

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

_MAX_PDF_BYTES = 15 * 1024 * 1024  # 15 MB

# Teto do vinculo em massa. Cada SKU vira uma ida ao Linx (resolucao do produto
# + upsert da propriedade); sem teto, uma planilha colada inteira seguraria o
# request por minutos e escreveria no ERP sem ninguem conseguir acompanhar.
_MAX_ITEMS_PER_REQUEST = 500

_SITUACOES = ("ATIVO", "ENCERRADO")


def _bounded(value: str, label: str, max_length: int) -> str:
    """Trim and length-check a multipart text field."""
    clean = value.strip()
    if len(clean) > max_length:
        raise HTTPException(400, f"{label} excede {max_length} caracteres")
    return clean


def _actor(request: Request, fallback: str = "") -> str | None:
    """Operador efetivo do request.

    Em producao o Nginx SOBRESCREVE `X-Cert-Actor-Email` com o e-mail que o
    auth_request do Node devolveu, entao ele vence qualquer campo de formulario
    (que o cliente controla).
    """
    gateway = (request.headers.get("X-Cert-Actor-Email") or "").strip()
    return gateway[:320] or fallback or None


def _parse_skus(raw: str) -> list[str]:
    """Le uma lista de SKUs colada da planilha (uma por linha, virgula ou ';').

    Preserva a ORDEM e remove repetidos, para que a previa mostre exatamente o
    que o operador colou. Nao valida formato: quem decide se o SKU existe e o
    Linx.
    """
    parts = [p.strip() for p in raw.replace(";", "\n").replace(",", "\n").splitlines()]
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        if not part or part in seen:
            continue
        seen.add(part)
        out.append(part)
    return out


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
        "fim_venda",
        "vencimento_licenciamento",
        "linx_applied_at",
        "created_at",
        "updated_at",
    ):
        v = row.get(f)
        if v is not None and hasattr(v, "isoformat"):
            row[f] = v.isoformat()
    if row.get("id") is not None:
        row["id"] = str(row["id"])
    return row


def _serialize_item(row: dict) -> dict:
    """Serialize a cert_certificate_items row to JSON-safe types."""
    out = dict(row)
    out["id"] = str(out["id"])
    out["certificate_id"] = str(out["certificate_id"])
    for f in ("linx_applied_at", "added_at", "removed_at"):
        v = out.get(f)
        if v is not None and hasattr(v, "isoformat"):
            out[f] = v.isoformat()
    return out


def _fetch_active_items(cur, cert_id: str) -> list[dict]:
    """Itens ainda vinculados (sem `removed_at`) de um certificado."""
    cur.execute(
        "SELECT * FROM cert_certificate_items "
        "WHERE certificate_id = %s AND removed_at IS NULL ORDER BY added_at, sku",
        [cert_id],
    )
    return [_serialize_item(dict(r)) for r in cur.fetchall()]


def _write_item_to_linx(brand: str, sku: str, fim_venda: str | None, vencimento: str | None) -> dict:
    """Grava no Linx as datas de UM item do certificado.

    Decisao D11: a propriedade de certificacao (00106 Imaginarium / 00224 Puket)
    e, na pratica, o FIM DE VENDA — a view de faturamento da Puket bloqueia por
    `PRODUTO_CORES.FIM_VENDAS`, que espelha essa propriedade. Mandar a VALIDADE
    para la travava produto com certificado ativo (PI5558Y ficou bloqueado desde
    27/07/2026 com certificado valido ate 2028). Por isso o que sobe e
    `fim_venda`, nunca `validade_certificado`; certificado ativo sem fim de venda
    nao grava nada nessa propriedade (`write_certificate_to_linx` trata None como
    "skipped (sem valor)").
    """
    return write_certificate_to_linx(brand, sku, fim_venda or None, vencimento or None)


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


def _link_skus(cert: dict, skus: list[str], actor: str | None, dry_run: bool) -> dict:
    """Vincula uma lista de SKUs a um certificado, classificando cada um.

    Cada SKU cai em exatamente um balde:

    - `invalid`: vazio ou acima de 100 caracteres;
    - `already_linked`: ja vinculado a ESTE certificado (vinculo vivo);
    - `linked_to_other_active_cert`: vinculo vivo em OUTRO certificado ATIVO —
      a dupla certificacao e decisao do time fiscal, nao do sistema, entao aqui
      nao se grava nada (nem no banco, nem no Linx);
    - `not_found_in_linx`: o Linx nao conhece o codigo; sem produto no ERP o
      vinculo nao teria efeito nenhum e vira erro visivel em vez de linha muda;
    - `added`: vinculado.

    `dry_run=True` e o caminho da PREVIA: classifica com o que o banco sabe e
    nao chama o Linx nem grava.

    Returns:
        Dict com uma lista de SKUs por balde, `linx` (detalhe por item gravado)
        e `dry_run`.
    """
    cert_id = str(cert["id"])
    brand = cert["brand"]
    fim_venda = cert.get("fim_venda")
    vencimento = cert.get("vencimento_licenciamento")
    out: dict = {
        "dry_run": dry_run,
        "added": [],
        "already_linked": [],
        "linked_to_other_active_cert": [],
        "not_found_in_linx": [],
        "invalid": [],
        "linx": [],
    }

    candidatos = [s for s in skus if s and len(s) <= 100]
    out["invalid"] = [s for s in skus if not s or len(s) > 100]
    if not candidatos:
        return out

    with db() as (conn, cur):
        cur.execute(
            "SELECT sku FROM cert_certificate_items "
            "WHERE certificate_id = %s AND removed_at IS NULL AND sku = ANY(%s)",
            [cert_id, candidatos],
        )
        ja_neste = {r["sku"] for r in cur.fetchall()}
        cur.execute(
            """
            SELECT i.sku AS sku, c.numero_certificado AS numero
            FROM cert_certificate_items i
            JOIN cert_certificates c ON c.id = i.certificate_id
            WHERE i.removed_at IS NULL
              AND i.certificate_id <> %s
              AND COALESCE(c.situacao, 'ATIVO') = 'ATIVO'
              AND i.sku = ANY(%s)
            """,
            [cert_id, candidatos],
        )
        em_outro = {r["sku"]: r["numero"] for r in cur.fetchall()}

    for sku in candidatos:
        if sku in ja_neste:
            out["already_linked"].append(sku)
            continue
        if sku in em_outro:
            out["linked_to_other_active_cert"].append(
                {"sku": sku, "numero_certificado": em_outro[sku]}
            )
            continue
        if dry_run:
            out["added"].append(sku)
            continue

        linx = _write_item_to_linx(brand, sku, fim_venda, vencimento)
        if linx.get("produto_codigo") is None and "nao encontrado" in (linx.get("error") or ""):
            out["not_found_in_linx"].append(sku)
            continue

        applied_at = datetime.now(UTC) if linx["status"] == "applied" else None
        try:
            with db() as (conn, cur):
                cur.execute(
                    """
                    INSERT INTO cert_certificate_items
                        (certificate_id, sku, brand, produto_codigo, linx_status,
                         linx_error, linx_detail, linx_applied_at, added_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    [
                        cert_id, sku, brand, linx.get("produto_codigo"), linx["status"],
                        linx.get("error"), json.dumps(linx.get("details", [])),
                        applied_at, actor,
                    ],
                )
        except pg_errors.UniqueViolation:
            # Corrida com outro operador vinculando o mesmo SKU: o indice unico
            # parcial (certificate_id, sku) WHERE removed_at IS NULL e quem
            # decide, e o resultado honesto e "ja vinculado".
            out["already_linked"].append(sku)
            continue

        out["added"].append(sku)
        out["linx"].append(
            {
                "sku": sku,
                "status": linx["status"],
                "produto_codigo": linx.get("produto_codigo"),
                "error": linx.get("error"),
                "details": linx.get("details", []),
            }
        )

    return out


@router.post("/api/certificates")
@limiter.limit("30/minute")
def create_certificate(
    request: Request,
    sku: str = Form(""),
    skus: str = Form(""),
    brand: str = Form(...),
    validade_certificado: str = Form(""),
    fim_venda: str = Form(""),
    vencimento_licenciamento: str = Form(""),
    numero_certificado: str = Form(""),
    situacao: str = Form(""),
    ocp: str = Form(""),
    orgao_certificador: str = Form(""),
    created_by: str = Form(""),
    pdf: UploadFile | None = File(None),
) -> dict:
    """Register a new certificate, link its products and write the dates to Linx.

    Accepts multipart/form-data (so the certificate PDF can be uploaded). The
    record is always saved in Postgres first; the Linx upsert then runs per
    linked product and its outcome is stored on both the item and — para o
    primeiro item, preservando o contrato anterior de um certificado por SKU —
    na propria linha do certificado.

    `sku` (um) e `skus` (lista colada, uma por linha) sao intercambiaveis; o
    primeiro e o formato legado do formulario.

    Returns:
        The created certificate record (serialized) with `items` e `link_result`.

    Raises:
        HTTPException: 400 on invalid input, 500 if the database is unavailable.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Banco de dados nao configurado")

    sku = _bounded(sku, "SKU", 100)
    brand = _bounded(brand, "Marca", 100)
    validade_certificado = _iso_date(validade_certificado, "Validade do certificado")
    fim_venda = _iso_date(fim_venda, "Fim de venda")
    vencimento_licenciamento = _iso_date(
        vencimento_licenciamento, "Vencimento do licenciamento"
    )
    numero_certificado = _bounded(numero_certificado, "Numero do certificado", 255)
    ocp = _bounded(ocp, "OCP", 255)
    orgao_certificador = _bounded(orgao_certificador, "Orgao certificador", 255)
    created_by = _bounded(created_by, "Responsavel", 320)
    situacao = (situacao or "ATIVO").strip().upper()
    if situacao not in _SITUACOES:
        raise HTTPException(400, "Situacao deve ser ATIVO ou ENCERRADO")

    lista = _parse_skus(skus)
    if sku and sku not in lista:
        lista.insert(0, sku)
    if len(lista) > _MAX_ITEMS_PER_REQUEST:
        raise HTTPException(400, f"Vincule no maximo {_MAX_ITEMS_PER_REQUEST} SKUs por vez")

    if not lista or not brand:
        raise HTTPException(400, "SKU e marca sao obrigatorios")
    if not is_brand_supported(brand):
        raise HTTPException(400, "Marca sem integracao Linx configurada")
    if not validade_certificado and not fim_venda and not vencimento_licenciamento:
        raise HTTPException(
            400,
            "Informe ao menos uma data (validade do certificado, fim de venda ou "
            "vencimento do licenciamento)",
        )

    effective_created_by = _actor(request, created_by)

    cert_id = str(uuid.uuid4())
    pdf_filename = _save_pdf(pdf, cert_id) if pdf is not None and pdf.filename else None

    with db() as (conn, cur):
        cur.execute(
            """
            INSERT INTO cert_certificates
                (id, sku, brand, validade_certificado, fim_venda, situacao,
                 vencimento_licenciamento, numero_certificado, ocp,
                 orgao_certificador, pdf_filename, linx_status, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s)
            """,
            [
                cert_id, lista[0], brand,
                validade_certificado or None, fim_venda or None, situacao,
                vencimento_licenciamento or None,
                numero_certificado or None, ocp or None, orgao_certificador or None,
                pdf_filename, effective_created_by,
            ],
        )

    cert = {
        "id": cert_id,
        "brand": brand,
        "fim_venda": fim_venda or None,
        "vencimento_licenciamento": vencimento_licenciamento or None,
    }
    link_result = _link_skus(cert, lista, effective_created_by, dry_run=False)

    # A linha do certificado continua exibindo o resultado do PRIMEIRO SKU (o
    # contrato antigo, de um certificado por SKU, que a tela ainda mostra). O
    # Linx e chamado uma unica vez por SKU, dentro de `_link_skus` — repetir a
    # chamada aqui gravaria duas vezes no ERP.
    linx = next(
        (e for e in link_result["linx"] if e["sku"] == lista[0]),
        {
            "status": "pending",
            "produto_codigo": None,
            "error": "SKU nao vinculado (ja pertence a outro certificado ativo ou nao existe no Linx)",
            "details": [],
        },
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
        row["items"] = _fetch_active_items(cur, cert_id)

    row["link_result"] = link_result

    # replace inline de CR/LF (anti log-injection) — o CodeQL só reconhece o
    # sanitizador aplicado diretamente na variável, não via helper
    sku_log = lista[0].replace("\r", " ").replace("\n", " ")
    brand_log = brand.replace("\r", " ").replace("\n", " ")
    log.info(
        f"Certificate {cert_id} saved (sku={sku_log}, brand={brand_log}, "
        f"itens={len(lista)}, linx={linx['status']})"
    )
    return row


@router.get("/api/certificates")
def list_certificates(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    sku: str = Query(""),
    brand: str = Query(""),
    numero: str = Query(""),
    situacao: str = Query(""),
    linx_status: str = Query(""),
) -> dict:
    """List registered certificates with optional filters.

    O filtro `sku` cobre tanto o SKU legado da propria linha quanto os itens
    vinculados (`cert_certificate_items`): depois da D11 o SKU mora nos itens, e
    procurar so na coluna legada devolveria vazio para tudo que foi cadastrado
    pelo vinculo em massa.

    Returns:
        Paginated dict with items, total, page, per_page, total_pages.
    """
    if not DATABASE_URL:
        return {"items": [], "total": 0, "page": 1, "per_page": per_page, "total_pages": 0}

    conditions: list[str] = []
    params: list = []
    if sku:
        conditions.append(
            "(sku ILIKE %s OR EXISTS (SELECT 1 FROM cert_certificate_items ci "
            "WHERE ci.certificate_id = cert_certificates.id AND ci.removed_at IS NULL "
            "AND ci.sku ILIKE %s))"
        )
        params.extend([f"%{sku}%", f"%{sku}%"])
    if numero:
        conditions.append("numero_certificado ILIKE %s")
        params.append(f"%{numero}%")
    if situacao:
        conditions.append("COALESCE(situacao, 'ATIVO') = %s")
        params.append(situacao.strip().upper())
    if brand:
        # Mesma normalizacao de /api/products, /api/expired e do relatorio: a UI
        # manda o slug `puket_escolares`. `LOWER(brand) = LOWER(%s)` so funcionava
        # porque o formulario grava o valor cru — quebraria no primeiro
        # "Puket Escolares" gravado.
        conditions.append("LOWER(REPLACE(brand, '_', ' ')) = %s")
        params.append(normalize_brand_filter(brand))
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

        if items:
            # Uma consulta agregada para a pagina inteira — um COUNT por linha
            # seria N+1 numa tela que ja pagina de 10 em 10.
            cur.execute(
                "SELECT certificate_id, COUNT(*) AS cnt FROM cert_certificate_items "
                # `::uuid[]` explicito: psycopg2 adapta a lista como text[], e
                # `uuid = ANY(text[])` nao resolve sozinho.
                "WHERE removed_at IS NULL AND certificate_id = ANY(%s::uuid[]) GROUP BY certificate_id",
                [[c["id"] for c in items]],
            )
            counts = {str(r["certificate_id"]): r["cnt"] for r in cur.fetchall()}
            for c in items:
                c["items_count"] = counts.get(c["id"], 0)

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
    """Get a single certificate by id, with its active items.

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
        out = _serialize(dict(row))
        out["items"] = _fetch_active_items(cur, cert_id)
        return out


def _load_certificate(cert_id: str) -> dict:
    """Le um certificado pelo id ou levanta 404/500 com a mensagem do portal."""
    if not DATABASE_URL:
        raise HTTPException(500, "Banco de dados nao configurado")
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_certificates WHERE id=%s", [cert_id])
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Certificado nao encontrado")
        return dict(row)


@router.post("/api/certificates/{cert_id}/items")
@limiter.limit("30/minute")
def link_certificate_items(request: Request, cert_id: str, req: CertificateItemsRequest) -> dict:
    """Vincula SKUs em massa a um certificado ja cadastrado.

    `dry_run=true` e a PREVIA usada pela tela antes de confirmar: nao chama o
    Linx nem grava. Com `dry_run=false` cada SKU aceito recebe a gravacao das
    datas do certificado no Linx (fim de venda e licenciamento).

    Returns:
        O resultado da classificacao (`added`, `already_linked`,
        `linked_to_other_active_cert`, `not_found_in_linx`, `invalid`, `linx`) e
        a lista de itens ativos apos a operacao.

    Raises:
        HTTPException: 400 quando a lista e vazia ou maior que o teto, 404 se o
            certificado nao existe.
    """
    cert = _load_certificate(cert_id)
    lista = _parse_skus("\n".join(req.skus or []))
    if not lista:
        raise HTTPException(400, "Informe ao menos um SKU")
    if len(lista) > _MAX_ITEMS_PER_REQUEST:
        raise HTTPException(400, f"Vincule no maximo {_MAX_ITEMS_PER_REQUEST} SKUs por vez")

    result = _link_skus(cert, lista, _actor(request), dry_run=bool(req.dry_run))
    if not req.dry_run:
        with db() as (conn, cur):
            result["items"] = _fetch_active_items(cur, cert_id)
        log.info(
            f"Certificate {cert_id}: {len(result['added'])} item(s) vinculado(s), "
            f"{len(result['already_linked'])} ja vinculado(s), "
            f"{len(result['not_found_in_linx'])} fora do Linx"
        )
    return result


@router.delete("/api/certificates/{cert_id}/items/{sku}")
@limiter.limit("60/minute")
def remove_certificate_item(request: Request, cert_id: str, sku: str) -> dict:
    """Remove UM item do certificado (soft delete, com historico).

    A remocao NAO limpa a trava do produto no Linx: apagar a data de fim de
    venda por efeito colateral liberaria faturamento sem ninguem decidir isso.
    O vinculo some da tela e o valor do ERP continua onde esta (ver
    open_questions da reuniao de 11/09).

    Raises:
        HTTPException: 404 quando o certificado nao existe ou o SKU nao esta
            vinculado a ele.
    """
    _load_certificate(cert_id)
    with db() as (conn, cur):
        cur.execute(
            "UPDATE cert_certificate_items SET removed_at = NOW(), removed_by = %s "
            "WHERE certificate_id = %s AND sku = %s AND removed_at IS NULL",
            [_actor(request), cert_id, sku],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "SKU nao esta vinculado a este certificado")
        items = _fetch_active_items(cur, cert_id)

    sku_log = sku.replace("\r", " ").replace("\n", " ")
    log.info(f"Certificate {cert_id}: item {sku_log} removido")
    return {"ok": True, "sku": sku, "items": items}


@router.delete("/api/certificates/{cert_id}")
@limiter.limit("30/minute")
def delete_certificate(request: Request, cert_id: str) -> dict:
    """Exclui um certificado que ainda nao tenha itens vinculados.

    A FK `cert_certificate_items.certificate_id` e `ON DELETE RESTRICT`: um
    certificado com itens NAO some por cascata, porque isso apagaria em silencio
    o historico de qual produto foi certificado por qual documento. O erro do
    banco viraria um 500 opaco, entao a condicao e verificada antes e a violacao
    e traduzida em 409 com o numero de itens.

    Raises:
        HTTPException: 404 se nao existe, 409 se ainda ha itens vinculados.
    """
    _load_certificate(cert_id)
    with db() as (conn, cur):
        # O RESTRICT conta TODA linha da tabela, inclusive a ja removida
        # (removed_at preenchido): ela continua sendo historico com FK. A
        # mensagem separa os dois para nao dizer "tem 3 produtos vinculados"
        # quando os tres foram removidos e o que sobra e o registro.
        cur.execute(
            "SELECT COUNT(*) AS total, "
            "COUNT(*) FILTER (WHERE removed_at IS NULL) AS ativos "
            "FROM cert_certificate_items WHERE certificate_id = %s",
            [cert_id],
        )
        counts = cur.fetchone() or {}
        total = counts.get("total", 0)
        ativos = counts.get("ativos", 0)
    if total:
        detalhe = (
            f"O certificado tem {ativos} produto(s) vinculado(s). "
            "Remova os itens antes de excluir."
            if ativos
            else f"O certificado guarda o historico de {total} produto(s) ja removido(s) "
            "e nao pode ser excluido."
        )
        raise HTTPException(409, detalhe)

    try:
        with db() as (conn, cur):
            cur.execute("DELETE FROM cert_certificates WHERE id = %s", [cert_id])
            if cur.rowcount == 0:
                raise HTTPException(404, "Certificado nao encontrado")
    except pg_errors.ForeignKeyViolation as exc:
        # Corrida: alguem vinculou um item entre a contagem e o DELETE.
        raise HTTPException(
            409, "O certificado passou a ter produtos vinculados. Atualize a lista."
        ) from exc

    log.info(f"Certificate {cert_id} deleted")
    return {"ok": True}


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
    cert = _load_certificate(cert_id)
    if not cert.get("sku"):
        raise HTTPException(
            400, "Certificado sem SKU proprio: reenvie pelos itens vinculados"
        )

    linx = _write_item_to_linx(
        cert["brand"], cert["sku"],
        cert.get("fim_venda"), cert.get("vencimento_licenciamento"),
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
