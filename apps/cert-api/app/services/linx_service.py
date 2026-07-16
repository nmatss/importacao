"""Write certificate dates into Linx product properties (PROP_PRODUTOS).

Fail-closed: nothing is written to Linx unless LINX_WRITE_ENABLED is true. While
disabled, certificates are still persisted in the portal (Postgres) and reported
back with linx_status='disabled' so the UI can show them as pending.
"""

from datetime import date, datetime

from app.config import LINX_BRANDS, LINX_SCHEMA, LINX_WRITE_ENABLED
from app.db.sqlserver import (
    _brand_linx,
    read_produto_propriedade,
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


def _parse_br_date(value: str) -> date | None:
    """Le uma data dd/mm/aaaa; devolve None para texto ('venda ate fim do lote')."""
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime((value or "").strip(), fmt).date()
        except ValueError:
            continue
    return None


def sync_prazo_venda_to_linx(dry_run: bool = True, brand_filter: str | None = None) -> dict:
    """Grava o PRAZO FINAL VENDA da planilha na propriedade de validade do Linx.

    O time fiscal mantem o prazo final de venda na aba "Encerramentos"; o Linx
    guarda o mesmo dado na propriedade VALIDADE DO CERTIFICADO (00224 Puket /
    00106 Imaginarium), que vinha sem ser atualizada. Este sync reconcilia os dois.

    `dry_run=True` (padrao) NAO escreve nada: apenas classifica o que aconteceria.
    Escrever no ERP de producao exige `dry_run=False` explicito.

    Dois grupos nunca sao gravados, nem com `dry_run=False`, porque dependem de
    decisao de negocio e nao podem sair como efeito colateral de um sync:
    - `encurta_janela`: o prazo da planilha e anterior ao que ja esta no Linx, entao
      gravar TIRA dias de venda do produto.
    - `ambiguos`: o mesmo SKU aparece em encerramentos com prazos diferentes
      (produto recertificado) — qual certificado vale nao e o codigo que decide.

    Args:
        dry_run: quando True, so simula.
        brand_filter: limita a uma marca (ex.: 'puket'); None processa todas.

    Returns:
        Dict com `dry_run`, contadores por acao e a lista `items` (uma entrada por
        SKU, com sku/brand/prazo/valor_atual/acao), alem de `encurta_janela`.
    """
    from app.services.erp_service import read_encerramentos_prazos

    result: dict = {
        "dry_run": dry_run,
        "counts": {},
        "items": [],
        "encurta_janela": [],
        "ambiguos": [],
        "error": None,
    }

    if not dry_run and not LINX_WRITE_ENABLED:
        result["error"] = "Escrita no Linx desabilitada (LINX_WRITE_ENABLED=false)"
        return result

    linhas = read_encerramentos_prazos()
    if not linhas:
        result["error"] = "Nenhum prazo lido da aba 'Encerramentos'"
        return result

    counts: dict[str, int] = {}

    def registrar(item: dict, acao: str, chave: str | None = None) -> None:
        """Fecha o item com a acao e contabiliza (chave agrupa erros variaveis)."""
        item["acao"] = acao
        counts[chave or acao] = counts.get(chave or acao, 0) + 1
        result["items"].append(item)

    # Um SKU pode aparecer em mais de um encerramento (produto recertificado: o
    # mesmo codigo com certificados e prazos diferentes). Processar linha a linha
    # faria a ORDEM DAS LINHAS decidir o prazo — a ultima grava por cima da
    # primeira, e a segunda ainda compara contra o valor que a primeira acabou de
    # escrever. Qual certificado vale e decisao de negocio: agrupamos por SKU e,
    # havendo prazos divergentes, nao gravamos.
    por_sku: dict[str, list[dict]] = {}
    for linha in linhas:
        por_sku.setdefault(linha["sku"], []).append(linha)

    for sku, grupo in por_sku.items():
        linha = grupo[0]
        prazo_raw, brand = linha["sale_deadline"], linha["brand"]
        if brand_filter and brand_filter.lower() not in brand.lower():
            continue
        item = {"sku": sku, "brand": brand, "prazo": prazo_raw, "valor_atual": None, "acao": None}

        prazos = {ln["sale_deadline"] for ln in grupo}
        if len(prazos) > 1:
            certs = sorted({ln.get("certificado") or "?" for ln in grupo})
            item["prazo"] = " | ".join(sorted(prazos))
            result["ambiguos"].append({**item, "certificados": certs})
            registrar(item, "ambiguo (prazos divergentes p/ o mesmo SKU)")
            continue

        prazo_date = _parse_br_date(prazo_raw)
        if prazo_date is None:
            # "venda ate fim do lote" e afins: nao ha data para gravar num campo
            # de mascara 99/99/9999.
            registrar(item, "ignorado (prazo sem data)")
            continue

        try:
            cfg = _brand_linx(brand)
        except ValueError:
            registrar(item, "erro (marca sem Linx)")
            continue

        try:
            produto = resolve_produto_codigo(brand, sku)
        except Exception as e:
            registrar(item, f"erro (resolver: {str(e)[:60]})", "erro (resolver)")
            continue

        if not produto:
            registrar(item, "ignorado (SKU nao existe no Linx)")
            continue

        prop = cfg["prop_validade_certificado"]
        valor = _format_date(prazo_date)
        atual = read_produto_propriedade(brand, produto, prop)
        item["valor_atual"] = atual

        if atual is not None and atual.strip() == valor:
            registrar(item, "ja correto")
            continue

        atual_date = _parse_br_date(atual or "")
        if atual_date and atual_date > prazo_date:
            # Gravar aqui TIRA dias de venda: separa para decisao explicita e nao
            # grava nem com dry_run=False.
            result["encurta_janela"].append(
                {**item, "acao": "encurta janela", "dias_a_menos": (atual_date - prazo_date).days}
            )
            registrar(item, "encurta janela")
            continue

        if dry_run:
            registrar(item, "gravaria" if atual is not None else "inseriria")
            continue

        try:
            registrar(item, upsert_produto_propriedade(brand, produto, prop, valor))
        except Exception as e:
            registrar(item, f"erro (gravacao: {str(e)[:60]})", "erro (gravacao)")

    result["counts"] = counts
    return result


# Re-export so callers don't reach into config directly.
SUPPORTED_BRANDS = list(LINX_BRANDS.keys())
