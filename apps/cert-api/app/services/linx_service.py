"""Write certificate dates into Linx product properties (PROP_PRODUTOS).

Fail-closed: nothing is written to Linx unless LINX_WRITE_ENABLED is true. While
disabled, certificates are still persisted in the portal (Postgres) and reported
back with linx_status='disabled' so the UI can show them as pending.
"""

from datetime import date, datetime

from app.config import LINX_BRANDS, LINX_SCHEMA, LINX_WRITE_ENABLED
from app.db.sqlserver import (
    _brand_linx,
    resolve_produto_codigo,
    upsert_produto_propriedade,
)
from app.utils.logging import log


def _format_date(value: str | date | datetime | None) -> str:
    """Format a date for the Linx VALOR_PROPRIEDADE text column.

    Accepts ISO strings ('YYYY-MM-DD'), date/datetime objects, or already-formatted
    strings. Uses LINX_SCHEMA['date_format'] (default dd/mm/YYYY).

    Args:
        value: The date to format.

    Returns:
        Formatted date string, or '' if value is empty/unparseable.
    """
    if not value:
        return ""
    fmt = LINX_SCHEMA.get("date_format", "%d/%m/%Y")
    if isinstance(value, datetime):
        return value.date().strftime(fmt)
    if isinstance(value, date):
        return value.strftime(fmt)
    s = str(value).strip()
    for parse_fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s[:19] if "T" in s else s, parse_fmt).strftime(fmt)
        except ValueError:
            continue
    # Unrecognized format — store as given rather than dropping the value.
    return s


def is_brand_supported(brand: str) -> bool:
    """Return True if the brand maps to a configured Linx database."""
    try:
        _brand_linx(brand)
        return True
    except ValueError:
        return False


def write_certificate_to_linx(
    brand: str,
    sku: str,
    validade_certificado: str | date | None,
    vencimento_licenciamento: str | date | None,
) -> dict:
    """Upsert the two certification properties for a product into Linx.

    Args:
        brand: Brand name (selects Puket vs Imaginarium Linx + property codes).
        sku: Portal SKU; resolved to the base product code internally.
        validade_certificado: Date for the 'VALIDADE DO CERTIFICADO' property.
        vencimento_licenciamento: Date for the 'VENCIMENTO DO LICENCIAMENTO' property.

    Returns:
        Dict with keys:
            status: 'applied' | 'disabled' | 'error'
            produto_codigo: resolved product code (when applicable)
            details: per-property result list
            error: error message when status == 'error'
    """
    result: dict = {
        "status": "disabled",
        "produto_codigo": None,
        "details": [],
        "error": None,
    }

    if not LINX_WRITE_ENABLED:
        result["error"] = (
            "Escrita no Linx desabilitada (LINX_WRITE_ENABLED=false). "
            "Confirme as colunas via sql/linx_discovery.sql antes de habilitar."
        )
        return result

    try:
        cfg = _brand_linx(brand)
    except ValueError as e:
        result["status"] = "error"
        result["error"] = str(e)
        return result

    try:
        produto = resolve_produto_codigo(brand, sku)
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"Falha ao resolver SKU '{sku}' -> produto: {e}"
        return result

    if not produto:
        result["status"] = "error"
        result["error"] = f"SKU '{sku}' nao encontrado no Linx ({cfg['db']})"
        return result

    result["produto_codigo"] = produto

    targets = [
        ("validade_certificado", cfg["prop_validade_certificado"], validade_certificado),
        (
            "vencimento_licenciamento",
            cfg["prop_vencimento_licenciamento"],
            vencimento_licenciamento,
        ),
    ]

    try:
        for field, prop_code, raw_value in targets:
            valor = _format_date(raw_value)
            if not valor:
                result["details"].append(
                    {"field": field, "prop": prop_code, "action": "skipped (sem valor)"}
                )
                continue
            action = upsert_produto_propriedade(brand, produto, prop_code, valor)
            result["details"].append(
                {"field": field, "prop": prop_code, "valor": valor, "action": action}
            )
            # replace inline de CR/LF (anti log-injection) — o CodeQL só reconhece
            # o sanitizador aplicado diretamente na variável, não via helper
            produto_log = produto.replace("\r", " ").replace("\n", " ")
            valor_log = valor.replace("\r", " ").replace("\n", " ")
            log.info(
                f"Linx {cfg['db']}: produto={produto_log} prop={prop_code} -> {valor_log} ({action})"
            )
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"Falha ao gravar propriedade no Linx: {e}"
        sku_log = sku.replace("\r", " ").replace("\n", " ")
        brand_log = brand.replace("\r", " ").replace("\n", " ")
        log.error(f"Linx write failed for sku={sku_log} brand={brand_log}: {e}", exc_info=True)
        return result

    result["status"] = "applied"
    return result


# Re-export so callers don't reach into config directly.
SUPPORTED_BRANDS = list(LINX_BRANDS.keys())
