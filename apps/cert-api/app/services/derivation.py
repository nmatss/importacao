"""Derivações de status (port do projeto Verificao_status — sessão 2026-05-22).

Recebe um row de `cert_products` e devolve 4 dimensões semânticas adicionais
que o time fiscal (Carla) pediu na reunião:

    cert_status            ATIVO | ENCERRADO | SKU_EXCLUIDO | EM_ANDAMENTO | DESCONHECIDO
    site_status            CONFORME | NAO_CONFORME | PENDENTE
    license_status         ATIVO | VENCIDO | NAO_APLICAVEL
    comercializacao_status LIBERADA | DENTRO_PRAZO | ENCERRADA | NAO_APLICA

Sem efeitos colaterais; sem dependências externas; campos computados em runtime
(não persiste no DB). Pode ser usado direto em routes ou em report_service.
"""

from __future__ import annotations

# Palavras-chave que indicam "produto regulado por órgão de certificação".
# Vem do scraper.py + cert_service.py (que já detecta inmetro/anatel/abnt/anvisa).
REGULATED_KEYWORDS = (
    "INMETRO", "ANATEL", "MAPA", "ANVISA", "ABNT", "OCP", "BRICS",
)


# ---------- Constantes / valores válidos ----------

CERT_STATUS_VALUES = {"ATIVO", "ENCERRADO", "SKU_EXCLUIDO", "EM_ANDAMENTO", "DESCONHECIDO"}
SITE_STATUS_VALUES = {"CONFORME", "NAO_CONFORME", "PENDENTE"}
LICENSE_STATUS_VALUES = {"ATIVO", "VENCIDO", "NAO_APLICAVEL"}
COMERCIALIZACAO_STATUS_VALUES = {"LIBERADA", "DENTRO_PRAZO", "ENCERRADA", "NAO_APLICA"}


# ---------- Helpers ----------

def _is_regulated(cert_type: str | None) -> bool:
    """True se o tipo de certificação menciona órgão regulado conhecido."""
    if not cert_type:
        return False
    up = str(cert_type).upper()
    return any(k in up for k in REGULATED_KEYWORDS)


def _norm(s: str | None) -> str:
    if not s:
        return ""
    return str(s).strip().lower()


# ---------- Derivações ----------

def derive_cert_status(
    sheet_status: str | None,
    is_expired: bool | None,
    sale_deadline_raw: str | None,
) -> str:
    """Status da certificação.

    Regras (consenso reunião 2026-05-21 com Carla):
    - SKU excluído             → SKU_EXCLUIDO
    - Em andamento             → EM_ANDAMENTO
    - Ativo / Finalizado       → ATIVO
    - EXPIRING                 → ATIVO (vai expirar mas ainda no prazo)
    - EXPIRED / Vencido        → ENCERRADO
    - Encerrado + prazo lote/futuro → ATIVO (ainda comercializa)
    - Encerrado + prazo vencido     → ENCERRADO
    - sheet_status histórico (texto livre) → fallback por is_expired + prazo
    """
    s = _norm(sheet_status)

    if not s:
        # Vazio: usa is_expired/prazo como sinal
        return _fallback_from_expiration(is_expired, sale_deadline_raw)

    if "exclu" in s:
        return "SKU_EXCLUIDO"
    if "andamento" in s:
        return "EM_ANDAMENTO"
    if s == "ativo" or "finalizad" in s or s == "expiring":
        return "ATIVO"
    if s == "expired" or "vencid" in s:
        # Marcador binário de encerramento
        deadline = _norm(sale_deadline_raw)
        if "fim do lote" in deadline or "fim de lote" in deadline or "ate o fim" in deadline:
            return "ATIVO"
        return "ENCERRADO"

    # Variações que indicam encerramento da certificação
    if "encerrad" in s:
        deadline = _norm(sale_deadline_raw)
        if "fim do lote" in deadline or "fim de lote" in deadline or "ate o fim" in deadline:
            return "ATIVO"
        if "vencido" in deadline:
            return "ENCERRADO"
        if is_expired:
            return "ENCERRADO"
        # Encerrado mas sem flag de vencido → assume dentro do prazo
        return "ATIVO"

    # sheet_status é texto longo histórico (ex: "01/09/25 - Registro concedido...")
    # → fallback pelo estado de expiração concreto.
    return _fallback_from_expiration(is_expired, sale_deadline_raw)


def _fallback_from_expiration(is_expired: bool | None, sale_deadline_raw: str | None) -> str:
    """Quando sheet_status é vazio ou texto livre, deduz pelos sinais binários."""
    deadline = _norm(sale_deadline_raw)
    if "fim do lote" in deadline or "fim de lote" in deadline or "ate o fim" in deadline:
        return "ATIVO"
    if "vencido" in deadline:
        return "ENCERRADO"
    if is_expired:
        return "ENCERRADO"
    if deadline:
        # Tem prazo mas não vencido → ativo dentro do prazo
        return "ATIVO"
    # Sem qualquer sinal → assume ATIVO (não bloquear; sem motivo pra dizer encerrado)
    return "ATIVO"


def derive_site_status(
    last_validation_status: str | None,
    cert_status: str,
    expected_cert_text: str | None,
    certification_type: str | None,
) -> str:
    """Status de conformidade no e-commerce.

    Regra refinada da reunião: "frase obrigatória ausente em produto regulado
    com cert ATIVO = NAO_CONFORME" (era PENDENTE silencioso antes).
    """
    vs = last_validation_status

    # Nunca validado contra o site → não dá pra afirmar nada
    if vs is None or vs == "":
        return "PENDENTE"

    # Cadastro incompleto (frase esperada vazia) em produto regulado + cert ativa
    if (
        vs == "NO_EXPECTED"
        and not expected_cert_text
        and cert_status == "ATIVO"
        and _is_regulated(certification_type)
    ):
        return "NAO_CONFORME"

    if vs == "NO_EXPECTED":
        return "PENDENTE"

    found_on_site = vs != "URL_NOT_FOUND"

    # Cert encerrada / SKU excluído: se está no site, é não-conforme
    if cert_status in ("SKU_EXCLUIDO", "ENCERRADO"):
        return "NAO_CONFORME" if found_on_site else "CONFORME"

    if cert_status == "ATIVO":
        if vs == "URL_NOT_FOUND":
            return "CONFORME"  # fora do site é OK
        if vs == "OK":
            return "CONFORME"
        if vs == "EXPIRED":
            return "NAO_CONFORME"
        # MISSING / INCONSISTENT / API_ERROR
        return "NAO_CONFORME"

    # EM_ANDAMENTO / DESCONHECIDO → indefinido
    return "PENDENTE"


def derive_license_status(
    certification_type: str | None,
    is_expired: bool | None,
) -> str:
    """Status de licenciamento.

    Versão simplificada — usa `is_expired` como proxy de licença vencida.
    Pode ser refinada quando o time popular `Validade da Certificação` real.
    """
    if not _is_regulated(certification_type):
        return "NAO_APLICAVEL"
    if is_expired:
        return "VENCIDO"
    return "ATIVO"


def derive_comercializacao_status(
    cert_status: str,
    sale_deadline_raw: str | None,
    sheet_status: str | None,
) -> str:
    """Status de comercialização (cobertura do "estatório de cessamento")."""
    if cert_status in ("SKU_EXCLUIDO", "EM_ANDAMENTO"):
        return "NAO_APLICA"
    s = _norm(sheet_status)
    deadline = _norm(sale_deadline_raw)
    if cert_status == "ATIVO":
        # Ativo mas com SITUAÇÃO=Encerrado e prazo até final do lote = dentro do prazo
        if "encerrad" in s or "fim do lote" in deadline or "fim de lote" in deadline:
            return "DENTRO_PRAZO"
        return "LIBERADA"
    if cert_status == "ENCERRADO":
        return "ENCERRADA"
    return "NAO_APLICA"


# ---------- Orquestrador ----------

def compute_status_dimensions(row: dict) -> dict[str, str]:
    """Recebe um dict de cert_products (psycopg2 DictRow ou similar) e devolve
    os 4 status semânticos como dict ready-to-merge no response.

    O caller é responsável por mesclar (ex.: `row.update(compute_status_dimensions(row))`).
    """
    sheet_status = row.get("sheet_status")
    is_expired = bool(row.get("is_expired") or False)
    sale_deadline_raw = row.get("sale_deadline")
    certification_type = row.get("certification_type")
    expected_cert_text = row.get("expected_cert_text")
    last_vs = row.get("last_validation_status")

    cs = derive_cert_status(sheet_status, is_expired, sale_deadline_raw)
    ss = derive_site_status(last_vs, cs, expected_cert_text, certification_type)
    ls = derive_license_status(certification_type, is_expired)
    cms = derive_comercializacao_status(cs, sale_deadline_raw, sheet_status)
    return {
        "cert_status": cs,
        "site_status": ss,
        "license_status": ls,
        "comercializacao_status": cms,
    }
