"""Certificate registration routes — portal form + auto-write to Linx.

Desde a reuniao de 11/09/2026 (decisao D11) o certificado e uma ENTIDADE com N
produtos, e nao mais um atributo de um SKU: os SKUs vivem em
`cert_certificate_items`, que permite vinculo em massa e remocao individual com
historico (`removed_at`/`removed_by`).
"""

import json
import re
import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from psycopg2 import errors as pg_errors
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import CERTS_DIR, DATABASE_URL
from app.db.postgres import db
from app.models.schemas import (
    CertificateItemRestrictionRequest,
    CertificateItemsBatchRequest,
    CertificateItemsRequest,
)
from app.services.derivation import BUSINESS_TIMEZONE, parse_data_real
from app.services.erp_service import normalize_brand_filter
from app.services.linx_service import (
    is_brand_supported,
    read_certificate_from_linx,
    write_certificate_to_linx,
)
from app.services.sync_runs import sheet_sync_lock
from app.utils.logging import log

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

_MAX_PDF_BYTES = 15 * 1024 * 1024  # 15 MB

# Teto do vinculo em massa. Cada SKU vira uma ida ao Linx (resolucao do produto
# + upsert da propriedade); sem teto, uma planilha colada inteira seguraria o
# request por minutos e escreveria no ERP sem ninguem conseguir acompanhar.
_MAX_ITEMS_PER_REQUEST = 500

# Lock compartilhado entre replicas antes de ler conflitos e chamar o ERP.
_CERTIFICATE_LINK_LOCK_KEY = 776_120_912

_SITUACOES = ("ATIVO", "ENCERRADO")

# Resumo de um lote: vence o status de MENOR numero, para que um problema nunca
# seja escondido por um sucesso. "skipped" (Linx ligado, nada a gravar — item de
# certificado ATIVO) nao e problema: fica depois de "applied", entao um lote
# misto aparece como gravado e so um lote inteiro sem gravacao aparece como
# "skipped". Status fora do mapa cai em 0 (pior caso) nos `.get(..., 0)`.
_LINX_STATUS_PRIORITY = {"error": 0, "pending": 1, "disabled": 2, "applied": 3, "skipped": 4}


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


# Token com cara de data ("30/10/2026", "2026-10-30", "30.10.26"). Nenhum SKU
# real tem esse formato; quando aparece no lugar do SKU e porque o operador colou
# a coluna de datas junto.
_DATE_LIKE = re.compile(r"^\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}$")
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def _looks_like_date(token: str) -> bool:
    return bool(_DATE_LIKE.match(token)) or parse_data_real(token) is not None


def _sku_problem(sku: str) -> str | None:
    """Por que este texto NAO pode ser gravado como SKU (None = pode)."""
    if not sku:
        return "SKU vazio"
    if len(sku) > 100:
        return "SKU excede 100 caracteres"
    if _CONTROL_CHARS.search(sku):
        return "SKU contem TAB ou outro caractere de controle"
    if _looks_like_date(sku):
        return f"'{sku}' parece uma data no lugar do SKU"
    return None


def _reject_dates_in_sku_list(skus: list[str]) -> None:
    """Lista SIMPLES de SKUs nao aceita data: falha alto em vez de gravar lixo.

    Colar "PI7001Y;30/10/2026" na lista simples virava os SKUs 'PI7001Y' e
    '30/10/2026' (e, com TAB, um SKU so, com o TAB dentro). Ignorar a data em
    silencio tambem seria errado — o operador sairia achando que ela foi gravada.
    """
    datas = [s for s in skus if _looks_like_date(s)]
    if datas:
        raise HTTPException(
            400,
            f"A lista de SKUs contem data no lugar de SKU ({_sample(datas, 3)}). Esta lista aceita somente "
            "SKUs; para informar a data de cada produto use a carga 'SKU;data' no painel de produtos do "
            "certificado.",
        )


def _parse_skus(raw: str) -> list[str]:
    """Le uma lista de SKUs colada da planilha (uma por linha, virgula, ';' ou TAB).

    Preserva a ORDEM e remove repetidos, para que a previa mostre exatamente o
    que o operador colou. Se o SKU existe quem decide e o Linx; o que NAO pode
    ser SKU (data, caractere de controle) e barrado por `_sku_problem`.
    """
    parts = [p.strip() for p in re.split(r"[;,\t\r\n]", raw)]
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


def _item_restriction(item: dict, certificate: dict) -> dict:
    parent_situation = certificate.get("situacao") or "ATIVO"
    inconsistent = item.get("situacao") == "ATIVO" and parent_situation == "ENCERRADO"
    situation = parent_situation if inconsistent else item.get("situacao") or parent_situation
    inherited_deadline = item.get("fim_venda") if item.get("fim_venda") is not None else certificate.get("fim_venda")
    deadline = parse_data_real(inherited_deadline) if situation == "ENCERRADO" and not inconsistent else None
    return {
        "situacao_efetiva": situation,
        "fim_venda_efetivo": deadline.isoformat() if deadline else None,
        "restricao_pendente": inconsistent or (situation == "ENCERRADO" and deadline is None),
        "restricao_origem": "item" if item.get("situacao") is not None or item.get("fim_venda") is not None else "certificado",
    }


def _item_linx_result(brand: str, item: dict, certificate: dict) -> dict:
    restriction = _item_restriction(item, certificate)
    if restriction["restricao_pendente"]:
        return {"status": "pending", "produto_codigo": item.get("produto_codigo"),
                "error": "Restricao individual inconsistente ou sem fim de venda valido; confirmar antes do envio ao Linx", "details": []}
    return _write_item_to_linx(
        brand, item["sku"], restriction["fim_venda_efetivo"], None, situacao=restriction["situacao_efetiva"]
    )


def _serialize_item(row: dict, certificate: dict | None = None) -> dict:
    """Serialize a cert_certificate_items row to JSON-safe types."""
    out = dict(row)
    out["id"] = str(out["id"])
    out["certificate_id"] = str(out["certificate_id"])
    for f in ("linx_applied_at", "added_at", "removed_at", "fim_venda", "restriction_updated_at"):
        v = out.get(f)
        if v is not None and hasattr(v, "isoformat"):
            out[f] = v.isoformat()
    out.update(_item_restriction(row, certificate or {}))
    return out


def _fetch_active_items(cur, cert_id: str, certificate: dict) -> list[dict]:
    """Itens ainda vinculados (sem `removed_at`) de um certificado."""
    cur.execute(
        "SELECT * FROM cert_certificate_items "
        "WHERE certificate_id = %s AND removed_at IS NULL ORDER BY added_at, sku",
        [cert_id],
    )
    return [_serialize_item(dict(r), certificate) for r in cur.fetchall()]


def _write_item_to_linx(
    brand: str, sku: str, fim_venda: str | None, vencimento: str | None, situacao: str | None = None
) -> dict:
    """Grava no Linx as datas de UM item do certificado.

    Decisao D11: a propriedade de certificacao (00106 Imaginarium / 00224 Puket)
    e, na pratica, o FIM DE VENDA — a view de faturamento da Puket bloqueia por
    `PRODUTO_CORES.FIM_VENDAS`, que espelha essa propriedade. Mandar a VALIDADE
    para la travava produto com certificado ativo (PI5558Y ficou bloqueado desde
    27/07/2026 com certificado valido ate 2028). Por isso o que sobe e
    `fim_venda`, nunca `validade_certificado`; certificado ativo sem fim de venda
    nao grava nada nessa propriedade (`write_certificate_to_linx` trata None como
    "skipped (sem valor)").

    `situacao` (efetiva do item) vai junto para que a guarda "certificado ATIVO
    nao grava" do linx_service dispare de verdade: sem ela a guarda dependia so
    de o chamador ja ter zerado a data.
    """
    return write_certificate_to_linx(
        brand, sku, None, None, fim_venda=fim_venda or None, situacao=situacao
    )


def _read_pdf(file: UploadFile) -> bytes:
    """Validate an uploaded certificate PDF and return its bytes (nothing is stored).

    A validacao roda ANTES do INSERT (um anexo invalido nao pode custar uma linha
    no banco) e a gravacao em disco so DEPOIS dele (`_store_pdf`): com o arquivo
    salvo primeiro, qualquer falha do INSERT — numero de certificado repetido,
    banco fora — deixava um PDF orfao em CERTS_DIR.

    Args:
        file: The uploaded file.

    Returns:
        The validated PDF content.

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
    return data


def _store_pdf(data: bytes, stored: str) -> None:
    """Persist already-validated PDF bytes to CERTS_DIR under `stored`."""
    (CERTS_DIR / stored).write_bytes(data)


def _sample(values: list[str], limit: int = 10) -> str:
    """Primeiros `limit` valores para uma mensagem de erro que cabe na tela."""
    shown = ", ".join(values[:limit])
    return f"{shown} e mais {len(values) - limit}" if len(values) > limit else shown


def _nothing_linked_detail(link_result: dict) -> str:
    """Explica por que NENHUM SKU do pedido pode ser vinculado."""
    parts = ["Certificado nao cadastrado: nenhum SKU pode ser vinculado."]
    outros = link_result.get("linked_to_other_active_cert") or []
    if outros:
        parts.append(
            "Em outro certificado ativo: "
            + _sample([f"{i['sku']} ({i.get('numero_certificado') or 'sem numero'})" for i in outros])
            + "."
        )
    if link_result.get("not_found_in_linx"):
        parts.append("Nao encontrados no Linx: " + _sample(link_result["not_found_in_linx"]) + ".")
    if link_result.get("invalid"):
        parts.append(f"{len(link_result['invalid'])} SKU(s) invalido(s).")
    return " ".join(parts)


def _discard_empty_certificate(cert_id: str, pdf_filename: str | None) -> bool:
    """Desfaz um certificado recem-criado que ficou SEM item nenhum.

    O `NOT EXISTS` cobre inclusive item ja removido: a linha com historico nunca
    e apagada por aqui (mesma regra do DELETE administrativo, FK RESTRICT).

    Returns:
        True quando a linha foi apagada (e o PDF, se havia, removido do disco).
    """
    try:
        with db() as (conn, cur):
            cur.execute(
                "DELETE FROM cert_certificates WHERE id = %s AND NOT EXISTS "
                "(SELECT 1 FROM cert_certificate_items WHERE certificate_id = %s)",
                [cert_id, cert_id],
            )
            removed = cur.rowcount > 0
    except Exception as exc:
        log.error(f"Could not discard empty certificate {cert_id}: type={type(exc).__name__}")
        return False
    if removed and pdf_filename:
        (CERTS_DIR / pdf_filename).unlink(missing_ok=True)
    return removed


def _other_active_certificates(cur, cert_id: str, brand: str, skus: list[str]) -> dict:
    brand_key = normalize_brand_filter(brand)
    aliases = ["puket", "puket escolares"] if brand_key in ("puket", "puket escolares") else [brand_key]
    cur.execute(
        """
        SELECT i.sku AS sku, c.numero_certificado AS numero
        FROM cert_certificate_items i JOIN cert_certificates c ON c.id = i.certificate_id
        WHERE i.removed_at IS NULL AND i.certificate_id <> %s
          AND COALESCE(i.situacao, c.situacao, 'ATIVO') = 'ATIVO'
          AND LOWER(REPLACE(c.brand, '_', ' ')) = ANY(%s)
          AND i.sku = ANY(%s)
        UNION
        SELECT c.sku AS sku, c.numero_certificado AS numero
        FROM cert_certificates c
        WHERE c.id <> %s AND COALESCE(c.situacao, 'ATIVO') = 'ATIVO'
          AND LOWER(REPLACE(c.brand, '_', ' ')) = ANY(%s) AND c.sku = ANY(%s)
          AND NOT EXISTS (SELECT 1 FROM cert_certificate_items history WHERE history.certificate_id = c.id)
        """, [cert_id, aliases, skus, cert_id, aliases, skus],
    )
    return {row["sku"]: row["numero"] for row in cur.fetchall()}


def _link_skus(cert: dict, skus: list[str], actor: str | None, dry_run: bool) -> dict:
    if dry_run:
        return _link_skus_locked(cert, skus, actor, dry_run=True)
    with sheet_sync_lock(_CERTIFICATE_LINK_LOCK_KEY) as acquired:
        if not acquired:
            raise HTTPException(409, "Outro vinculo de certificacao esta em andamento; tente novamente")
        return _link_skus_locked(cert, skus, actor, dry_run=False)


def _link_skus_locked(cert: dict, skus: list[str], actor: str | None, dry_run: bool) -> dict:
    """Vincula uma lista de SKUs a um certificado, classificando cada um.

    Cada SKU cai em exatamente um balde:

    - `invalid`: vazio, acima de 100 caracteres, com caractere de controle ou
      com cara de data (`_sku_problem`);
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
    out: dict = {
        "dry_run": dry_run,
        "added": [],
        "already_linked": [],
        "linked_to_other_active_cert": [],
        "not_found_in_linx": [],
        "invalid": [],
        "linx": [],
    }

    candidatos = [s for s in skus if _sku_problem(s) is None]
    out["invalid"] = [s for s in skus if _sku_problem(s) is not None]
    if not candidatos:
        return out

    with db() as (conn, cur):
        cur.execute(
            "SELECT sku FROM cert_certificate_items "
            "WHERE certificate_id = %s AND removed_at IS NULL AND sku = ANY(%s)",
            [cert_id, candidatos],
        )
        ja_neste = {r["sku"] for r in cur.fetchall()}
        em_outro = _other_active_certificates(cur, cert_id, brand, candidatos)

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

        linx = _item_linx_result(brand, {"sku": sku}, cert)
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

    Um certificado nunca fica gravado SEM produto: o lock de vinculo e tomado
    antes do INSERT e, se nenhum SKU do pedido pode ser vinculado, nada e
    gravado (ou o registro recem-criado e desfeito).

    Raises:
        HTTPException: 400 on invalid input or when no SKU can be linked, 409
            when another linking operation holds the lock, 500 if the database
            is unavailable.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Banco de dados nao configurado")

    sku = _bounded(sku, "SKU", 100)
    brand = _bounded(brand, "Marca", 100)
    validade_certificado = _iso_date(validade_certificado, "Validade do certificado")
    fim_venda = _iso_date(fim_venda, "Fim de venda")
    if vencimento_licenciamento.strip():
        raise HTTPException(400, "Licenciamento e mantido pelo time de Produto no Linx; campo somente leitura")
    vencimento_licenciamento = ""
    numero_certificado = _bounded(numero_certificado, "Numero do certificado", 255)
    ocp = _bounded(ocp, "OCP", 255)
    orgao_certificador = _bounded(orgao_certificador, "Orgao certificador", 255)
    created_by = _bounded(created_by, "Responsavel", 320)
    situacao = (situacao or "ATIVO").strip().upper()
    if situacao not in _SITUACOES:
        raise HTTPException(400, "Situacao deve ser ATIVO ou ENCERRADO")

    if situacao == "ATIVO" and fim_venda:
        raise HTTPException(400, "Certificado ativo nao possui fim de venda por certificacao")

    lista = _parse_skus(skus)
    if sku and sku not in lista:
        lista.insert(0, sku)
    _reject_dates_in_sku_list(lista)
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
    # O anexo e VALIDADO aqui e so vai para o disco depois do INSERT.
    pdf_bytes = _read_pdf(pdf) if pdf is not None and pdf.filename else None
    pdf_filename = f"{cert_id}.pdf" if pdf_bytes is not None else None
    cert = {
        "id": cert_id,
        "brand": brand,
        "situacao": situacao,
        "fim_venda": fim_venda or None,
        "vencimento_licenciamento": vencimento_licenciamento or None,
    }

    # O lock vem ANTES do INSERT: com ele depois, um lock ocupado devolvia 409
    # com o certificado ja gravado — um orfao sem item que o operador recadastrava
    # por cima (e batia no indice unico do numero).
    with sheet_sync_lock(_CERTIFICATE_LINK_LOCK_KEY) as acquired:
        if not acquired:
            raise HTTPException(409, "Outro vinculo de certificacao esta em andamento; tente novamente")

        # Previa com o que o banco ja sabe: se NENHUM SKU pode ser vinculado, nao
        # ha por que gravar certificado, PDF ou qualquer coisa.
        previa = _link_skus_locked(cert, lista, effective_created_by, dry_run=True)
        if not previa["added"]:
            raise HTTPException(400, _nothing_linked_detail(previa))

        try:
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
        except pg_errors.UniqueViolation as exc:
            # Indice unico (brand, numero_certificado). Sem este tratamento o
            # operador via um 500 opaco e recadastrava sem saber o motivo.
            raise HTTPException(
                409,
                f"Ja existe um certificado cadastrado com o numero '{numero_certificado}' para a marca "
                f"'{brand}'. Abra o certificado existente na lista e vincule os produtos a ele.",
            ) from exc

        try:
            if pdf_bytes is not None and pdf_filename:
                _store_pdf(pdf_bytes, pdf_filename)
            link_result = _link_skus_locked(cert, lista, effective_created_by, dry_run=False)
        except Exception:
            # Falha no meio do caminho: so desfaz se NENHUM item chegou a existir.
            _discard_empty_certificate(cert_id, pdf_filename)
            raise

        # "Existe no Linx?" so o ERP responde, e so na gravacao. Se nenhum SKU
        # passou, nada foi escrito no Linx e o certificado recem-criado e desfeito
        # em vez de ficar sem produto.
        if not link_result["added"]:
            detail = _nothing_linked_detail(link_result)
            if not _discard_empty_certificate(cert_id, pdf_filename):
                detail += " O registro do certificado nao pode ser desfeito automaticamente; avise a TI."
            raise HTTPException(400, detail)

    # Resultado do lote: erro de um SKU nao pode ser escondido pelo primeiro.
    resultados_linx = list(link_result["linx"])
    if any(link_result[key] for key in ("invalid", "not_found_in_linx", "linked_to_other_active_cert")):
        resultados_linx.append({
            "status": "pending", "produto_codigo": None,
            "error": "Lote incompleto: existem SKUs nao vinculados; consulte link_result", "details": [],
        })
    prioridade = _LINX_STATUS_PRIORITY
    linx = min(resultados_linx, key=lambda item: prioridade.get(item["status"], 0)) if resultados_linx else {
        "status": "pending", "produto_codigo": None,
        "error": "Nenhum SKU novo foi vinculado", "details": [],
    }
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
        row["items"] = _fetch_active_items(cur, cert_id, row)

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
            "((sku ILIKE %s AND NOT EXISTS (SELECT 1 FROM cert_certificate_items legacy "
            "WHERE legacy.certificate_id = cert_certificates.id)) OR EXISTS (SELECT 1 FROM cert_certificate_items ci "
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
        out["items"] = _fetch_active_items(cur, cert_id, out)
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
    _reject_dates_in_sku_list(lista)
    if len(lista) > _MAX_ITEMS_PER_REQUEST:
        raise HTTPException(400, f"Vincule no maximo {_MAX_ITEMS_PER_REQUEST} SKUs por vez")

    result = _link_skus(cert, lista, _actor(request), dry_run=bool(req.dry_run))
    if not req.dry_run:
        with db() as (conn, cur):
            result["items"] = _fetch_active_items(cur, cert_id, cert)
        log.info(
            f"Certificate {cert_id}: {len(result['added'])} item(s) vinculado(s), "
            f"{len(result['already_linked'])} ja vinculado(s), "
            f"{len(result['not_found_in_linx'])} fora do Linx"
        )
    return result


def _apply_item_restriction(
    cur, cert: dict, item: dict, situacao: str | None, fim_venda: date | None, reason: str, actor: str | None
) -> dict:
    """Grava a restricao local de UM item e o evento de auditoria (antes/depois).

    Unico ponto de escrita da restricao por item: usado pelo PATCH individual e
    pela carga em lote, para que os dois deixem exatamente o mesmo rastro em
    `cert_certificate_item_restriction_events`. Nunca chama o Linx: o item fica
    `pending` ate o reenvio. O chamador ja validou a coerencia e detem o lock.
    """
    proposed = {"situacao": situacao, "fim_venda": fim_venda}
    before = {"situacao": item.get("situacao"), "fim_venda": item.get("fim_venda"), **_item_restriction(item, cert)}
    after = {**proposed, **_item_restriction(proposed, cert)}
    cur.execute(
        "UPDATE cert_certificate_items SET situacao=%s, fim_venda=%s, restriction_updated_at=NOW(), "
        "restriction_updated_by=%s, linx_status='pending', linx_applied_at=NULL, "
        "linx_error='Restricao local alterada; envio ao Linx pendente', linx_detail=NULL "
        "WHERE id=%s RETURNING *", [situacao, fim_venda, actor, item["id"]],
    )
    updated = dict(cur.fetchone())
    _insert_restriction_event(cur, item["id"], before, after, reason, actor)
    return updated


def _insert_restriction_event(cur, item_id, before: dict, after: dict, reason: str, actor: str | None) -> None:
    cur.execute(
        "INSERT INTO cert_certificate_item_restriction_events (item_id,before_state,after_state,reason,actor) "
        "VALUES (%s,%s::jsonb,%s::jsonb,%s,%s)",
        [item_id, json.dumps(before, default=str), json.dumps(after, default=str), reason, actor],
    )


def _mark_certificate_pending(cur, cert_id: str) -> None:
    cur.execute(
        "UPDATE cert_certificates SET linx_status='pending', linx_applied_at=NULL, "
        "linx_error='Restricao de item alterada; envio ao Linx pendente', updated_at=NOW() WHERE id=%s",
        [cert_id],
    )


@router.patch("/api/certificates/{cert_id}/items/{sku}/restriction")
@limiter.limit("30/minute")
def update_item_restriction(request: Request, cert_id: str, sku: str, req: CertificateItemRestrictionRequest) -> dict:
    """Altera somente a restricao local do vinculo e audita antes/depois.

    Nao remove o vinculo, nao altera o certificado e nunca chama o Linx.
    Migration SQL explicita 20260912_certificate_item_restrictions e pre-requisito.
    """
    reason = req.motivo.strip()
    if not reason:
        raise HTTPException(400, "Informe o motivo da alteracao")
    if req.fim_venda is not None and parse_data_real(req.fim_venda) is None:
        raise HTTPException(400, "Fim de venda deve ser uma data valida, sem sentinela")
    cert = _load_certificate(cert_id)
    if req.situacao == "ATIVO" and cert.get("situacao") == "ENCERRADO":
        raise HTTPException(409, "Item nao pode reativar certificado encerrado; vincule certificacao vigente")
    proposed = {"situacao": req.situacao, "fim_venda": req.fim_venda}
    effective = _item_restriction(proposed, cert)
    if effective["situacao_efetiva"] == "ATIVO" and req.fim_venda is not None:
        raise HTTPException(400, "Item ativo nao possui fim de venda por certificacao")
    actor = _actor(request)
    with sheet_sync_lock(_CERTIFICATE_LINK_LOCK_KEY) as acquired:
        if not acquired:
            raise HTTPException(409, "Outro vinculo de certificacao esta em andamento; tente novamente")
        with db() as (conn, cur):
            cur.execute("SELECT * FROM cert_certificates WHERE id=%s FOR UPDATE", [cert_id])
            current_cert = cur.fetchone()
            if not current_cert:
                raise HTTPException(404, "Certificado nao encontrado")
            cert = dict(current_cert)
            effective = _item_restriction(proposed, cert)
            if req.situacao == "ATIVO" and cert.get("situacao") == "ENCERRADO":
                raise HTTPException(409, "Item nao pode reativar certificado encerrado; vincule certificacao vigente")
            if effective["situacao_efetiva"] == "ATIVO" and req.fim_venda is not None:
                raise HTTPException(400, "Item ativo nao possui fim de venda por certificacao")
            cur.execute(
                "SELECT * FROM cert_certificate_items WHERE certificate_id=%s AND sku=%s "
                "AND removed_at IS NULL FOR UPDATE", [cert_id, sku],
            )
            found = cur.fetchone()
            if not found:
                raise HTTPException(404, "SKU nao esta vinculado a este certificado")
            item = dict(found)
            if item.get("situacao") == req.situacao and str(item.get("fim_venda") or "") == str(req.fim_venda or ""):
                return _serialize_item(item, cert)
            if effective["situacao_efetiva"] == "ATIVO" and _other_active_certificates(cur, cert_id, cert["brand"], [sku]):
                raise HTTPException(409, "SKU possui outro vinculo ativo; resolver dupla certificacao antes de reativar")
            updated = _apply_item_restriction(cur, cert, item, req.situacao, req.fim_venda, reason, actor)
            _mark_certificate_pending(cur, cert_id)
            return _serialize_item(updated, cert)


# ---------------------------------------------------------------------------
# Carga em lote "SKU;data" — lista de produtos e suas respectivas datas
# ---------------------------------------------------------------------------

_BATCH_SEPARATORS = re.compile(r"[;,\t]")
_BATCH_SKU_SPACE_DATE = re.compile(r"^(\S+)\s+(\S+)$")
_MAX_BATCH_LINE_LENGTH = 200
_MAX_BATCH_REASON_LENGTH = 1000
_MAX_BATCH_RAW_LINES = 2000  # contando as linhas em branco do texto colado
_BATCH_ACTIONS = ("encerrar", "sem_alteracao", "vincular", "vincular_e_encerrar")


def _br(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def _parse_batch_lines(linhas: list[str]) -> list[dict]:
    """Interpreta as linhas coladas (`SKU` ou `SKU;data`) — sem tocar no banco.

    Separador: `;`, TAB (colado de duas colunas do Excel) ou virgula; tambem
    aceita `SKU data` separado por espaco quando o segundo trecho e uma data. A
    data passa pelo parser unico do projeto (`parse_data_real`: dd/mm/aaaa, ISO,
    e nunca a sentinela 01/01/1900).

    Linha em branco e pulada, mas a numeracao (`linha`) e a da caixa de texto,
    para o operador achar o erro onde ele esta. Toda linha nao vazia volta com
    `status` "ok", "erro" (com `mensagem`) ou "ignorada" (repeticao identica).
    """
    rows: list[dict] = []
    for numero, raw in enumerate(linhas, start=1):
        texto = str(raw).replace("\r", "").strip()
        if not texto:
            continue
        row: dict = {
            "linha": numero, "conteudo": texto[:_MAX_BATCH_LINE_LENGTH], "sku": None, "fim_venda": None,
            "acao": None, "status": "ok", "mensagem": "", "aviso": None,
        }
        rows.append(row)

        if len(texto) > _MAX_BATCH_LINE_LENGTH:
            row.update(status="erro", mensagem=f"Linha excede {_MAX_BATCH_LINE_LENGTH} caracteres")
            continue
        campos = [c.strip() for c in _BATCH_SEPARATORS.split(texto)]
        if len(campos) == 1:
            por_espaco = _BATCH_SKU_SPACE_DATE.match(campos[0])
            if por_espaco and _looks_like_date(por_espaco.group(2)):
                campos = [por_espaco.group(1), por_espaco.group(2)]
        while len(campos) > 1 and campos[-1] == "":
            campos.pop()  # "SKU;" ou a coluna de data vazia do Excel: so o SKU
        if len(campos) > 2:
            row.update(status="erro", mensagem="Use um produto por linha, no formato SKU ou SKU;data")
            continue

        sku = campos[0]
        problema = _sku_problem(sku)
        if problema:
            if sku and _looks_like_date(sku):
                problema += "; o formato e SKU;data"
            row.update(status="erro", mensagem=problema)
            continue
        row["sku"] = sku

        if len(campos) == 2:
            data = parse_data_real(campos[1])
            if data is None:
                row.update(status="erro", mensagem=f"Data invalida: '{campos[1]}'. Use dd/mm/aaaa (ex.: 30/10/2026)")
                continue
            row["fim_venda"] = data.isoformat()

    # Mesmo SKU duas vezes: identico e ignorado; com datas diferentes ninguem
    # adivinha qual vale — erro nas duas linhas.
    por_sku: dict[str, list[dict]] = {}
    for row in rows:
        if row["status"] == "ok":
            por_sku.setdefault(row["sku"], []).append(row)
    for grupo in por_sku.values():
        if len(grupo) < 2:
            continue
        numeros = ", ".join(str(r["linha"]) for r in grupo)
        if len({r["fim_venda"] for r in grupo}) > 1:
            for row in grupo:
                row.update(status="erro", mensagem=f"SKU repetido com datas diferentes (linhas {numeros})")
            continue
        for row in grupo[1:]:
            row.update(status="ignorada", acao="sem_alteracao",
                       mensagem=f"Linha repetida (igual a linha {grupo[0]['linha']}); ignorada")
    return rows


def _plan_items_batch(cur, cert: dict, rows: list[dict], encerrar_com_data: bool, for_update: bool) -> dict:
    """Decide, com o que o BANCO sabe, o que cada linha valida fara.

    Acoes: `vincular` (SKU novo, herda o certificado), `vincular_e_encerrar`
    (SKU novo ja com fim de venda), `encerrar` (item ja vinculado recebe
    ENCERRADO + fim de venda) e `sem_alteracao`. Nao chama o Linx — "o SKU existe
    no ERP?" so se descobre na gravacao, como no vinculo simples.

    Returns:
        `{sku: linha do item}` dos SKUs ja vinculados a este certificado.
    """
    cert_id = str(cert["id"])
    ativos = [r for r in rows if r["status"] == "ok"]
    skus = [r["sku"] for r in ativos]
    vinculados: dict[str, dict] = {}
    em_outro: dict = {}
    if skus:
        cur.execute(
            "SELECT * FROM cert_certificate_items WHERE certificate_id = %s AND removed_at IS NULL "
            "AND sku = ANY(%s)" + (" FOR UPDATE" if for_update else ""),
            [cert_id, skus],
        )
        vinculados = {r["sku"]: dict(r) for r in cur.fetchall() if r["sku"] in skus}
        novos = [sku for sku in skus if sku not in vinculados]
        if novos:
            em_outro = _other_active_certificates(cur, cert_id, cert["brand"], novos)

    hoje = datetime.now(BUSINESS_TIMEZONE).date()
    for row in ativos:
        sku = row["sku"]
        data = date.fromisoformat(row["fim_venda"]) if row["fim_venda"] else None
        item = vinculados.get(sku)
        if data is not None and not encerrar_com_data:
            row.update(status="erro", mensagem=(
                "Linha com data, mas o encerramento nao foi confirmado: item ativo nao possui fim de venda "
                "por certificacao. Confirme o encerramento dos itens com data ou remova a data"
            ))
            continue
        if item is None and sku in em_outro:
            row.update(status="erro", mensagem=(
                f"SKU vinculado a outro certificado ativo ({em_outro[sku] or 'sem numero'}); "
                "resolva a dupla certificacao antes de vincular aqui"
            ))
            continue
        if data is not None and data < hoje:
            row["aviso"] = f"Data no passado ({_br(data)}): a venda deste item ja fica encerrada"

        if item is None:
            if data is None:
                row.update(acao="vincular", mensagem="Vincular ao certificado (herda a situacao do certificado)")
            else:
                row.update(acao="vincular_e_encerrar",
                           mensagem=f"Vincular ao certificado e encerrar o item com fim de venda em {_br(data)}")
            continue
        if data is None:
            row.update(acao="sem_alteracao", mensagem="Ja vinculado a este certificado; sem data, nada muda")
            continue
        atual = parse_data_real(item.get("fim_venda"))
        if item.get("situacao") == "ENCERRADO" and atual == data:
            row.update(acao="sem_alteracao", mensagem=f"Item ja encerrado com fim de venda em {_br(data)}")
            continue
        substitui = f" (substitui {_br(atual)})" if atual else ""
        row.update(acao="encerrar", mensagem=f"Encerrar o item com fim de venda em {_br(data)}{substitui}")
    return vinculados


def _batch_response(rows: list[dict], dry_run: bool) -> dict:
    resumo = {acao: sum(1 for r in rows if r["status"] != "erro" and r["acao"] == acao) for acao in _BATCH_ACTIONS}
    resumo["erro"] = sum(1 for r in rows if r["status"] == "erro")
    return {
        "dry_run": dry_run,
        # Tudo-ou-nada: com UMA linha em erro nada e gravado, nem as linhas boas.
        "valid": resumo["erro"] == 0,
        "total_linhas": len(rows),
        "resumo": resumo,
        "linhas": rows,
    }


def _batch_errors_detail(rows: list[dict]) -> str:
    erros = [r for r in rows if r["status"] == "erro"]
    mostrados = "; ".join(f"Linha {r['linha']}: {r['mensagem']}" for r in erros[:5])
    resto = f" (e mais {len(erros) - 5})" if len(erros) > 5 else ""
    return f"Lote recusado, nada foi gravado: {len(erros)} linha(s) com erro. {mostrados}{resto}"


def _link_batch_row(cert: dict, row: dict, reason: str, actor: str | None) -> None:
    """Vincula UM SKU novo do lote (com ou sem encerramento) e registra o resultado na linha."""
    sku = row["sku"]
    data = date.fromisoformat(row["fim_venda"]) if row["fim_venda"] else None
    proposto = {"sku": sku, "situacao": "ENCERRADO", "fim_venda": data} if data else {"sku": sku}
    linx = _item_linx_result(cert["brand"], proposto, cert)
    if linx.get("produto_codigo") is None and "nao encontrado" in (linx.get("error") or ""):
        row.update(status="falhou", mensagem="SKU nao encontrado no Linx; nao foi vinculado")
        return

    applied_at = datetime.now(UTC) if linx["status"] == "applied" else None
    columns = ["certificate_id", "sku", "brand", "produto_codigo", "linx_status", "linx_error", "linx_detail",
               "linx_applied_at", "added_by"]
    values = [str(cert["id"]), sku, cert["brand"], linx.get("produto_codigo"), linx["status"], linx.get("error"),
              json.dumps(linx.get("details", [])), applied_at, actor]
    if data:
        # As colunas de restricao so entram quando ha data: o vinculo simples
        # continua independente da migration 20260912.
        columns += ["situacao", "fim_venda", "restriction_updated_at", "restriction_updated_by"]
        values += ["ENCERRADO", data, datetime.now(UTC), actor]
    placeholders = ", ".join("%s::jsonb" if c == "linx_detail" else "%s" for c in columns)
    try:
        with db() as (conn, cur):
            cur.execute(
                f"INSERT INTO cert_certificate_items ({', '.join(columns)}) VALUES ({placeholders}) RETURNING id",
                values,
            )
            item_id = cur.fetchone()["id"]
            if data:
                depois = {"situacao": "ENCERRADO", "fim_venda": data}
                _insert_restriction_event(
                    cur, item_id,
                    {"vinculado": False, "situacao": None, "fim_venda": None},
                    {"vinculado": True, **depois, **_item_restriction(depois, cert)},
                    reason, actor,
                )
    except pg_errors.UniqueViolation:
        row.update(status="falhou", mensagem="SKU vinculado por outro operador durante a gravacao; refaca a previa")
        return
    row.update(status="aplicado", linx_status=linx["status"], linx_error=linx.get("error"))


@router.post("/api/certificates/{cert_id}/items/batch")
@limiter.limit("30/minute")
def batch_certificate_items(request: Request, cert_id: str, req: CertificateItemsBatchRequest) -> dict:
    """Carga em lote de produtos e datas de um certificado (`SKU` ou `SKU;data`).

    Pedido do time fiscal (17/09/2026): atualizar muitos produtos de um
    certificado pela tela, sem depender da TI. Linha com data = ENCERRAR aquele
    item com aquele fim de venda (mesma regra e mesma auditoria do PATCH de
    restricao individual); linha sem data = apenas vincular.

    - A validacao e do SERVIDOR e e por linha (`linhas[].status == "erro"` com
      numero, conteudo e motivo). Com qualquer linha em erro NADA e gravado.
    - `dry_run=true` (padrao) e a previa obrigatoria: nao grava nem chama o Linx.
    - `motivo` e unico para o lote e vai para o evento de auditoria de cada item.
    - `encerrar_itens_com_data` confirma que as datas encerram os itens; sem
      ela, data em item ativo e erro ("item ativo nao possui fim de venda").
    - Item JA vinculado fica `pending` (como no PATCH, nunca chama o Linx); SKU
      novo segue o vinculo simples, que tenta o Linx na hora com a data do item.

    Raises:
        HTTPException: 400 envelope invalido (motivo, vazio, mais de 500 linhas),
            404 certificado inexistente, 409 lock ocupado, 422 gravacao pedida com
            linha em erro.
    """
    reason = req.motivo.strip()
    if not reason:
        raise HTTPException(400, "Informe o motivo do lote (vai para a auditoria de cada item)")
    if len(reason) > _MAX_BATCH_REASON_LENGTH:
        raise HTTPException(400, f"O motivo excede {_MAX_BATCH_REASON_LENGTH} caracteres")
    if len(req.linhas) > _MAX_BATCH_RAW_LINES:
        # Linhas em branco nao contam para o teto de 500, mas tambem nao podem
        # virar um laco de milhoes de iteracoes.
        raise HTTPException(400, f"Texto com linhas demais ({len(req.linhas)}); envie no maximo {_MAX_BATCH_RAW_LINES}")
    preenchidas = sum(1 for linha in req.linhas if str(linha).strip())
    if preenchidas == 0:
        raise HTTPException(400, "Informe ao menos uma linha no formato SKU ou SKU;data")
    if preenchidas > _MAX_ITEMS_PER_REQUEST:
        raise HTTPException(400, f"Envie no maximo {_MAX_ITEMS_PER_REQUEST} linhas por vez")

    rows = _parse_batch_lines(req.linhas)
    cert = _load_certificate(cert_id)

    if req.dry_run:
        with db() as (conn, cur):
            _plan_items_batch(cur, cert, rows, req.encerrar_itens_com_data, for_update=False)
        return _batch_response(rows, dry_run=True)

    actor = _actor(request)
    with sheet_sync_lock(_CERTIFICATE_LINK_LOCK_KEY) as acquired:
        if not acquired:
            raise HTTPException(409, "Outro vinculo de certificacao esta em andamento; tente novamente")
        # 1) Revalida SOB o lock e encerra os itens ja vinculados em UMA transacao:
        #    ou todos mudam, ou nenhum.
        with db() as (conn, cur):
            cur.execute("SELECT * FROM cert_certificates WHERE id=%s FOR UPDATE", [cert_id])
            current = cur.fetchone()
            if not current:
                raise HTTPException(404, "Certificado nao encontrado")
            cert = dict(current)
            vinculados = _plan_items_batch(cur, cert, rows, req.encerrar_itens_com_data, for_update=True)
            if any(r["status"] == "erro" for r in rows):
                raise HTTPException(422, _batch_errors_detail(rows))
            encerrar = [r for r in rows if r["status"] == "ok" and r["acao"] == "encerrar"]
            for row in encerrar:
                _apply_item_restriction(
                    cur, cert, vinculados[row["sku"]], "ENCERRADO", date.fromisoformat(row["fim_venda"]), reason, actor
                )
                row["status"] = "aplicado"
            if encerrar:
                _mark_certificate_pending(cur, cert_id)
        # 2) SKUs novos: um a um, porque cada vinculo conversa com o Linx (que nao
        #    participa da transacao). Falha de um SKU fica na linha dele.
        for row in rows:
            if row["status"] == "ok" and row["acao"] in ("vincular", "vincular_e_encerrar"):
                _link_batch_row(cert, row, reason, actor)
        for row in rows:
            if row["status"] == "ok":
                row["status"] = "aplicado"  # sem_alteracao: conferido, nada a gravar

        result = _batch_response(rows, dry_run=False)
        with db() as (conn, cur):
            result["items"] = _fetch_active_items(cur, cert_id, cert)

    resumo = result["resumo"]
    log.info(
        f"Certificate {cert_id}: lote aplicado — {resumo['encerrar']} encerrado(s), "
        f"{resumo['vincular'] + resumo['vincular_e_encerrar']} vinculado(s), "
        f"{sum(1 for r in rows if r['status'] == 'falhou')} falha(s)"
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
    cert = _load_certificate(cert_id)
    with db() as (conn, cur):
        cur.execute(
            "UPDATE cert_certificate_items SET removed_at = NOW(), removed_by = %s "
            "WHERE certificate_id = %s AND sku = %s AND removed_at IS NULL",
            [_actor(request), cert_id, sku],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "SKU nao esta vinculado a este certificado")
        items = _fetch_active_items(cur, cert_id, cert)

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
    audit = {"event": "certificate_retry", "actor": _actor(request), "certificate_id": cert_id[:64]}
    # JSON escapes control characters; never include ERP errors or document data.
    log.info(json.dumps({**audit, "phase": "started", "status": "running"}, ensure_ascii=True))
    try:
        with sheet_sync_lock(_CERTIFICATE_LINK_LOCK_KEY) as acquired:
            if not acquired:
                raise HTTPException(409, "Outro vinculo de certificacao esta em andamento; tente novamente")
            result = _retry_linx_locked(request, cert_id)
    except Exception as exc:
        log.warning(json.dumps({**audit, "phase": "failed", "status": "error",
                                "http_status": exc.status_code if isinstance(exc, HTTPException) else 500,
                                "error_type": type(exc).__name__}, ensure_ascii=True))
        raise
    status = result.get("linx_status")
    status = status if status in _LINX_STATUS_PRIORITY else "unknown"
    log.info(json.dumps({**audit, "phase": "failed" if status == "error" else "finished",
                         "status": status}, ensure_ascii=True))
    return result


def _retry_linx_locked(request: Request, cert_id: str) -> dict:
    """Retry the Linx upsert for a previously saved certificate.

    Useful after enabling LINX_WRITE_ENABLED or fixing the schema config.

    Raises:
        HTTPException: 404 if not found, 500 if DB unavailable.
    """
    cert = _load_certificate(cert_id)
    resultados = []
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_certificates WHERE id=%s FOR UPDATE", [cert_id])
        current_cert = cur.fetchone()
        if not current_cert:
            raise HTTPException(404, "Certificado nao encontrado")
        cert = dict(current_cert)
        # A remocao individual espera este lock; um item removido antes do retry
        # nunca e enviado usando o SKU legado da linha principal.
        cur.execute(
            "SELECT * FROM cert_certificate_items WHERE certificate_id = %s ORDER BY sku FOR UPDATE",
            [cert_id],
        )
        historico = [dict(item) for item in cur.fetchall()]
        ativos = [item for item in historico if item.get("removed_at") is None]
        if historico and not ativos:
            raise HTTPException(409, "Certificado sem itens ativos para reenvio; vinculos removidos preservados no historico")
        if not historico:
            if not cert.get("sku"):
                raise HTTPException(400, "Certificado sem itens vinculados para reenvio")
            ativos = [{"sku": cert["sku"]}]  # Compatibilidade apenas para registros sem historico de vinculo.

        other_active = _other_active_certificates(cur, cert_id, cert["brand"], [item["sku"] for item in ativos])
        for item in ativos:
            sku = item["sku"]
            if sku in other_active:
                resultado = {"status": "pending", "produto_codigo": item.get("produto_codigo"),
                             "error": "Outro certificado ativo vinculado ao SKU; prazo historico nao enviado ao Linx", "details": []}
            else:
                resultado = _item_linx_result(cert["brand"], item, cert)
            aplicado = datetime.now(UTC) if resultado["status"] == "applied" else None
            cur.execute(
                "UPDATE cert_certificate_items SET produto_codigo=%s, linx_status=%s, linx_error=%s, "
                "linx_detail=%s::jsonb, linx_applied_at=%s WHERE certificate_id=%s AND sku=%s AND removed_at IS NULL",
                [resultado.get("produto_codigo"), resultado["status"], resultado.get("error"),
                 json.dumps(resultado.get("details", [])), aplicado, cert_id, sku],
            )
            resultados.append({"sku": sku, **resultado})

        # Um item com erro nao pode ser escondido pelo sucesso do primeiro SKU.
        priority = _LINX_STATUS_PRIORITY
        linx = min(resultados, key=lambda item: priority.get(item["status"], 0))
        applied_at = datetime.now(UTC) if linx["status"] == "applied" else None
        cur.execute(
            """
            UPDATE cert_certificates
            SET produto_codigo=%s, linx_status=%s, linx_error=%s,
                linx_detail=%s, linx_applied_at=%s, updated_at=NOW()
            WHERE id=%s
            """,
            [linx.get("produto_codigo"), linx["status"], linx.get("error"),
             json.dumps(linx.get("details", [])), applied_at, cert_id],
        )
        cur.execute("SELECT * FROM cert_certificates WHERE id=%s", [cert_id])
        response = _serialize(dict(cur.fetchone()))
        response["retry_results"] = resultados
        return response
