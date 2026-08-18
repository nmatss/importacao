"""Google Sheets sync services for certifications and licenciados."""

import re
from collections import defaultdict
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials

from app.config import SHEETS_CLIENT_EMAIL, SHEETS_PRIVATE_KEY, SHEETS_SPREADSHEET_ID
from app.db.postgres import db
from app.services.derivation import derive_venda_encerramento
from app.utils.logging import log

# ---------------------------------------------------------------------------
# Layout da planilha "STATUS CERTIFICAÇÃO"
# ---------------------------------------------------------------------------
# Cada campo é (candidatos de cabeçalho, índice de fallback 0-based). O
# cabeçalho manda; o índice só entra quando a coluna foi renomeada. Letras de
# coluna conferidas contra a planilha em 2026-08-17.

_DESC_ECOMMERCE_HEADERS = (
    "descrição e-commerce", "descricao e-commerce",
    "descrição ecommerce", "descricao ecommerce",
    "desc e-commerce", "desc ecommerce",
)

# Abas "Imaginarium" e "Puket" compartilham o mesmo layout A..W.
_LAYOUT_MARCA = {
    "sku": (("código", "codigo"), 2),                                       # C
    "name": (("nome",), 5),                                                 # F
    "certification_type": (("tipo de certificação", "tipo de certificacao"), 7),  # H
    "sheet_status": (("status",), 9),                                       # J
    "numero_certificado": (("número certificado", "numero certificado"), 15),     # P
    "situacao": (("situação", "situacao"), 20),                             # U
    "ecommerce_description": (_DESC_ECOMMERCE_HEADERS, 21),                 # V
}

_ATIVOS_SHEETS = (
    {"name": "Imaginarium", "brand": "Imaginarium", "fields": _LAYOUT_MARCA},
    {"name": "Puket", "brand": "Puket", "fields": _LAYOUT_MARCA},
    {
        "name": "Puket escolares",
        "brand": "Puket Escolares",
        "fields": {
            "sku": (("sku",), 0),                                           # A
            "name": (("nome comercial (certificado)",), 1),                 # B
            # C e a categoria do produto (ESTOJO/LANCHEIRA). A coluna de tipo
            # de certificacao foi adicionada em D; o candidato generico "tipo"
            # fazia o match exato escolher C e contaminava painel/relatorio.
            "certification_type": (
                ("tipo de certificação", "tipo de certificacao"),
                3,
            ),                                                                 # D
            "sheet_status": (("status",), 7),                               # H
            "numero_certificado": (
                ("número certificado", "numero certificado", "certificado"),
                4,
            ),                                                                 # E
            "situacao": ((), None),
            "ecommerce_description": (_DESC_ECOMMERCE_HEADERS, 8),          # I
        },
    },
)

# Marcas canônicas gravadas em cert_products.brand. A coluna MARCA (A) das abas
# de produto NÃO é confiável: em 2026-08-07 uma das 111 linhas da Puket trazia
# 'Kayuan' — o nome do FORNECEDOR (coluna E) — e o item 100400496 chegava ao
# painel com marca 'Kayuan', o que quebrava a resolução da loja VTEX
# (last_validation_status=API_ERROR "No VTEX store configured") e o derrubava
# para "Nao conforme". A aba é que define a marca.
_BRAND_CANONICAL = {
    "imaginarium": "Imaginarium",
    "puket": "Puket",
    "puket escolares": "Puket Escolares",
    "puket_escolares": "Puket Escolares",
}

# EAN-13 (e variações de 12/14 dígitos) aparecem na coluna SKU da aba
# "Encerramentos" — 5 linhas em 2026-08-07, todas Puket. Sem tradução elas
# viram produtos fantasma no painel e no relatório.
_EAN_RE = re.compile(r"^\d{12,14}$")


def _canonical_brand(raw: str, default: str = "") -> str:
    """Normaliza o texto de marca da planilha para o rótulo canônico."""
    key = (raw or "").strip().lower().replace("_", " ")
    return _BRAND_CANONICAL.get(key, default or (raw or "").strip())


def normalize_brand_filter(value: str) -> str:
    """Normaliza o valor de filtro de marca vindo da UI para comparar com o banco.

    O frontend manda `puket_escolares` (slug), o banco guarda `Puket Escolares`.
    O relatório já normalizava; o painel comparava `LOWER(brand) = LOWER(%s)` e
    por isso o filtro "Puket Escolares" não devolvia nada. Usar esta função nos
    dois lados mantém painel e relatório filtrando igual.

    Returns:
        Texto em minúsculas, com `_` trocado por espaço, pronto para comparar
        com `LOWER(REPLACE(brand, '_', ' '))`.
    """
    return (value or "").strip().lower().replace("_", " ")


def _looks_like_ean(value: str) -> bool:
    """True quando o código tem cara de código de barras, não de SKU."""
    return bool(_EAN_RE.match((value or "").strip()))


def _get_sheets_client() -> gspread.Client | None:
    """Create an authenticated Google Sheets client.

    Returns:
        Authenticated gspread.Client or None if credentials are not configured.
    """
    if not SHEETS_CLIENT_EMAIL or not SHEETS_PRIVATE_KEY:
        log.warning("Google Sheets credentials not configured")
        return None
    try:
        creds = Credentials.from_service_account_info(
            {
                "type": "service_account",
                "client_email": SHEETS_CLIENT_EMAIL,
                "private_key": SHEETS_PRIVATE_KEY,
                "token_uri": "https://oauth2.googleapis.com/token",
            },
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
        )
        return gspread.authorize(creds)
    except Exception as e:
        log.error(f"Failed to create Sheets client: {e}")
        return None


def _find_col_by_header(headers: list[str], *candidates: str) -> int | None:
    """Find a column index by matching header text (case-insensitive).

    Faz duas passadas: primeiro cabeçalho IDÊNTICO ao candidato, depois
    substring. A passada exata evita o falso positivo clássico da aba
    "Puket escolares", onde procurar por "certificado" achava
    "NOME COMERCIAL (CERTIFICADO)" (coluna B) antes da coluna "CERTIFICADO" (D).

    Args:
        headers: List of header strings from the first row.
        *candidates: Header names to search for (exact first, then substring).

    Returns:
        Zero-based column index, or None if not found.
    """
    normalized = [h.lower().strip() for h in headers]
    wanted = [c.lower().strip() for c in candidates if c]
    for c in wanted:
        if c in normalized:
            return normalized.index(c)
    for i, h_lower in enumerate(normalized):
        for c in wanted:
            if c in h_lower:
                return i
    return None


def _resolve_columns(headers: list[str], fields: dict, sheet_name: str) -> dict[str, int | None]:
    """Resolve o índice de cada campo do layout: cabeçalho primeiro, índice depois.

    Args:
        headers: primeira linha da aba.
        fields: {campo: (candidatos_de_cabecalho, indice_fallback)}.
        sheet_name: nome da aba (só para log).

    Returns:
        {campo: índice 0-based ou None quando a coluna não existe na aba}.
    """
    resolved: dict[str, int | None] = {}
    for field, (candidates, fallback) in fields.items():
        idx = _find_col_by_header(headers, *candidates) if candidates else None
        if idx is None:
            idx = fallback
        elif fallback is not None and idx != fallback:
            log.info(
                f"Aba '{sheet_name}': coluna '{field}' encontrada em {idx} "
                f"(layout esperado: {fallback})"
            )
        resolved[field] = idx
    return resolved


def _cell(row: list, idx: int | None) -> str:
    """Le uma celula da linha, tolerando coluna ausente ou linha curta."""
    if idx is None or idx >= len(row):
        return ""
    return str(row[idx]).strip()


def read_encerramentos_prazos() -> list[dict]:
    """Read SKU + PRAZO FINAL VENDA + MARCA from the 'Encerramentos' tab.

    Fonte do prazo final de venda para o sync com o Linx. Le a aba direto, e nao
    `cert_products`, por dois motivos: a marca decide em qual Linx gravar e chega
    NULA na tabela (a linha de "Ativos" vence o upsert), e o prazo aqui e o dado
    cru que o time fiscal mantem.

    Returns:
        Lista de dicts {sku, sale_deadline, brand, certificado}, um por SKU
        (a coluna SKU pode trazer varios codigos separados por quebra de linha).
        Lista vazia quando o Sheets nao esta configurado ou a aba nao existe.
    """
    client = _get_sheets_client()
    if not client or not SHEETS_SPREADSHEET_ID:
        log.warning("Sheets nao configurado; sync de prazo abortado")
        return []

    try:
        ws = client.open_by_key(SHEETS_SPREADSHEET_ID).worksheet("Encerramentos")
    except gspread.exceptions.WorksheetNotFound:
        log.warning("Aba 'Encerramentos' nao encontrada")
        return []

    rows = ws.get_all_values()
    if not rows:
        return []

    headers = rows[0]
    i_sku = _find_col_by_header(headers, "sku", "código", "codigo", "ref")
    i_prazo = _find_col_by_header(headers, "prazo final venda", "prazo final", "prazo venda")
    i_marca = _find_col_by_header(headers, "marca", "brand")
    i_cert = _find_col_by_header(headers, "certificado")
    if i_sku is None or i_prazo is None or i_marca is None:
        log.warning(
            f"Aba 'Encerramentos' sem coluna obrigatoria (sku={i_sku} prazo={i_prazo} marca={i_marca})"
        )
        return []

    out: list[dict] = []
    for row in rows[1:]:
        prazo, marca = _cell(row, i_prazo), _cell(row, i_marca)
        if not prazo or not marca:
            continue
        for sku in re.split(r"[\r\n]+", _cell(row, i_sku)):
            sku = sku.strip()
            if sku:
                out.append(
                    {
                        "sku": sku,
                        "sale_deadline": prazo,
                        "brand": marca,
                        "certificado": _cell(row, i_cert),
                    }
                )
    log.info(f"Encerramentos: {len(out)} SKUs com prazo final de venda")
    return out


def _resolve_ean_skus(items: list[dict]) -> int:
    """Traduz, in-place, SKUs que na verdade sao codigo de barras.

    A coluna SKU da aba "Encerramentos" traz EAN em algumas linhas (5 em
    2026-08-07, todas Puket: 7909692117610 -> produto 100400416 etc.). Sem
    traducao esses codigos viram produtos fantasma — aparecem como SKU no painel
    e no relatorio e nunca casam com estoque, validacao ou Linx.

    Consulta o Linx (PRODUTOS_BARRA) por marca, apenas para os codigos com cara
    de EAN. Falha de conexao NAO derruba o sync: o codigo cru e mantido e a
    ocorrencia vai para o log.

    Args:
        items: dicts com chaves 'sku' e 'brand'; mutados no lugar.

    Returns:
        Quantidade de SKUs efetivamente traduzidos.
    """
    pendentes: dict[str, set[str]] = defaultdict(set)
    for it in items:
        if _looks_like_ean(it.get("sku", "")):
            pendentes[it.get("brand") or ""].add(it["sku"].strip())
    if not pendentes:
        return 0

    from app.db.sqlserver import fetch_barcode_map

    traduzidos = 0
    for brand, codes in pendentes.items():
        try:
            mapa = fetch_barcode_map(brand, sorted(codes))
        except Exception as e:
            log.warning(f"Nao foi possivel resolver EAN->SKU da marca '{brand}': {e}")
            continue
        for it in items:
            sku = it.get("sku", "").strip()
            if it.get("brand") == brand and sku in mapa:
                it["sku"] = mapa[sku]
                it["sku_origem_ean"] = sku
                traduzidos += 1
    if traduzidos:
        log.info(f"EAN->SKU resolvidos: {traduzidos}")
    return traduzidos


def _read_ativos_from_sheets(spreadsheet: gspread.Spreadsheet) -> list[dict]:
    """Le o cadastro de certificacao das abas de produto ativo.

    Cobre "Imaginarium", "Puket" e "Puket escolares". Cada campo e localizado
    pelo cabecalho, com o indice do layout como fallback (ver `_ATIVOS_SHEETS`).

    A MARCA vem da ABA, nunca da coluna A: ver `_BRAND_CANONICAL` (caso
    100400496 / 'Kayuan').

    Returns:
        Lista de dicts de cadastro, um por SKU.
    """
    produtos: list[dict] = []
    for cfg in _ATIVOS_SHEETS:
        try:
            ws = spreadsheet.worksheet(cfg["name"])
            rows = ws.get_all_values()
        except Exception as e:
            log.warning(f"Could not read worksheet '{cfg['name']}': {e}")
            continue
        if not rows:
            continue

        cols = _resolve_columns(rows[0], cfg["fields"], cfg["name"])
        i_sku = cols["sku"]
        if i_sku is None:
            log.warning(f"Aba '{cfg['name']}' sem coluna de SKU; ignorada")
            continue

        for row in rows[1:]:
            raw_sku = _cell(row, i_sku)
            if not raw_sku:
                continue
            for sku in re.split(r"[\r\n]+", raw_sku):
                sku = sku.strip()
                if not sku:
                    continue
                produtos.append({
                    "sku": sku,
                    "name": _cell(row, cols["name"]),
                    "brand": cfg["brand"],
                    "certification_type": _cell(row, cols["certification_type"]),
                    "numero_certificado": _cell(row, cols["numero_certificado"]),
                    "situacao": _cell(row, cols["situacao"]),
                    "sheet_status": _cell(row, cols["sheet_status"]),
                    "ecommerce_description": _cell(row, cols["ecommerce_description"]),
                })

    log.info(f"Ativos: {len(produtos)} SKUs lidos das abas de produto")
    return produtos


def _read_encerramentos_from_sheets(spreadsheet: gspread.Spreadsheet) -> list[dict]:
    """Le a aba "Encerramentos" — prazo final de venda e permissao de venda.

    Colunas (conferidas em 2026-08-07):
        A CERTIFICADO | B SKU | C NOME | D ESTOQUE INFORMADO | E DATA NOTIFICACAO
        F DATA LEMBRETE | G PRAZO FINAL VENDA | H STATUS | I CODIGO DE BARRAS
        J MARCA | K CUSTO MEDIO | L REF CONCATENADA

    A coluna H e o veredito do time fiscal ("Comerciacao Permitida" /
    "Vencido - Venda Bloqueada" / "Venda ate fim do lote"). A leitura antiga
    exigia data na coluna G e por isso DESCARTAVA as 28 linhas que so tem o
    status — entre elas PI7560Y, que aparecia no painel como Encerrado / Nao
    conforme sem ter prazo nenhum. Agora basta prazo OU status.

    Returns:
        Lista de dicts de encerramento, um por SKU.
    """
    try:
        ws = spreadsheet.worksheet("Encerramentos")
        rows = ws.get_all_values()
    except gspread.exceptions.WorksheetNotFound:
        log.info("Worksheet 'Encerramentos' not found, skipping")
        return []
    except Exception as e:
        log.warning(f"Error reading 'Encerramentos' worksheet: {e}")
        return []

    if not rows:
        return []

    headers = rows[0]
    i_sku = _find_col_by_header(headers, "sku", "código", "codigo", "ref")
    i_prazo = _find_col_by_header(headers, "prazo final venda", "prazo final", "prazo venda")
    i_status = _find_col_by_header(headers, "status", "situação", "situacao")
    i_marca = _find_col_by_header(headers, "marca", "brand")
    i_cert = _find_col_by_header(headers, "certificado")
    i_nome = _find_col_by_header(headers, "nome", "produto", "descrição", "descricao")
    if i_sku is None:
        log.warning("Aba 'Encerramentos' sem coluna de SKU; ignorada")
        return []

    today = datetime.now().date()
    out: list[dict] = []
    for row in rows[1:]:
        raw_sku = _cell(row, i_sku)
        if not raw_sku:
            continue
        prazo_str = _cell(row, i_prazo)
        status_str = _cell(row, i_status)
        if not prazo_str and not status_str:
            continue

        prazo_date = None
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
            try:
                prazo_date = datetime.strptime(prazo_str, fmt).date()
                break
            except ValueError:
                continue

        venda = derive_venda_encerramento(status_str)
        if venda == "BLOQUEADA":
            is_expired = True
        elif venda in ("PERMITIDA", "FIM_LOTE"):
            is_expired = False
        elif prazo_date is not None:
            is_expired = prazo_date < today
        else:
            # Sem data e sem veredito reconhecido: nao inventa vencimento.
            is_expired = "vencido" in f"{prazo_str} {status_str}".lower()

        for sku in re.split(r"[\r\n]+", raw_sku):
            sku = sku.strip()
            if not sku:
                continue
            out.append({
                "sku": sku,
                "name": _cell(row, i_nome),
                "brand": _canonical_brand(_cell(row, i_marca)),
                "numero_certificado": _cell(row, i_cert),
                "sale_deadline": prazo_str,
                "sale_deadline_date": prazo_date.isoformat() if prazo_date else None,
                "encerramento_status": status_str,
                "is_expired": is_expired,
            })

    _resolve_ean_skus(out)
    bloqueados = sum(1 for e in out if e["is_expired"])
    sem_prazo = sum(1 for e in out if not e["sale_deadline"])
    log.info(
        f"Encerramentos: {len(out)} SKUs ({bloqueados} com venda bloqueada, "
        f"{sem_prazo} sem data na coluna G)"
    )
    return out


# SQL do cadastro (abas de produto). Os campos que a planilha controla sao
# atribuidos DIRETAMENTE, sem COALESCE: quando a celula esvazia, o portal tem de
# esvaziar junto. Era o COALESCE que deixava `expected_cert_text` e
# `certification_type` carregando texto velho ("ENCERRAMENTO - Prazo: ...")
# depois que a planilha ja tinha corrigido a linha.
_UPSERT_ATIVOS_SQL = """
    INSERT INTO cert_products
        (sku, name, brand, certification_type, numero_certificado, situacao,
         expected_cert_text, ecommerce_description, sheet_status, updated_at)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    ON CONFLICT (sku) DO UPDATE SET
        name = COALESCE(NULLIF(EXCLUDED.name, ''), cert_products.name),
        brand = COALESCE(NULLIF(EXCLUDED.brand, ''), cert_products.brand),
        certification_type = EXCLUDED.certification_type,
        numero_certificado = EXCLUDED.numero_certificado,
        situacao = EXCLUDED.situacao,
        expected_cert_text = EXCLUDED.expected_cert_text,
        ecommerce_description = EXCLUDED.ecommerce_description,
        sheet_status = COALESCE(NULLIF(EXCLUDED.sheet_status, ''), cert_products.sheet_status),
        updated_at = NOW()
"""

# SQL do encerramento. Roda DEPOIS do cadastro e so mexe nos campos que a aba
# "Encerramentos" possui. name/brand/numero_certificado sao preenchidos apenas
# quando o cadastro nao trouxe nada (SKU que so existe em encerramentos).
_UPSERT_ENCERRAMENTOS_SQL = """
    INSERT INTO cert_products
        (sku, name, brand, numero_certificado, sale_deadline, sale_deadline_date,
         encerramento_status, is_expired, updated_at)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
    ON CONFLICT (sku) DO UPDATE SET
        name = COALESCE(NULLIF(cert_products.name, ''), EXCLUDED.name),
        brand = COALESCE(NULLIF(cert_products.brand, ''), EXCLUDED.brand),
        numero_certificado = COALESCE(
            NULLIF(cert_products.numero_certificado, ''), EXCLUDED.numero_certificado
        ),
        -- Limpeza do lixo que o sync antigo gravava. Para o SKU que existe nas
        -- abas de produto a passada de cadastro ja reescreveu estes dois campos;
        -- sobra o SKU que SO existe em "Encerramentos", que nenhuma passada toca
        -- e por isso conservava "ENCERRAMENTO - Prazo: dd/mm/aaaa" como tipo de
        -- certificacao E como texto esperado (115 linhas em 07/08/2026). A aba
        -- nao tem esses dados, entao o valor fiel e vazio.
        certification_type = CASE
            WHEN cert_products.certification_type LIKE 'ENCERRAMENTO - Prazo%%' THEN ''
            ELSE cert_products.certification_type
        END,
        expected_cert_text = CASE
            WHEN cert_products.expected_cert_text LIKE 'ENCERRAMENTO - Prazo%%' THEN ''
            ELSE cert_products.expected_cert_text
        END,
        sale_deadline = EXCLUDED.sale_deadline,
        sale_deadline_date = EXCLUDED.sale_deadline_date,
        encerramento_status = EXCLUDED.encerramento_status,
        is_expired = EXCLUDED.is_expired,
        updated_at = NOW()
"""

# Um SKU que saiu da aba "Encerramentos" tem de perder prazo e status junto. O
# upsert antigo fazia COALESCE em sale_deadline/sale_deadline_date e nunca os
# limpava: PI7560Y seguia exibindo "28/07/2028" muito depois de a celula da
# planilha ter sido esvaziada.
# A marca canonica e gravada pela passada de cadastro, mas o SKU que so existe em
# "Encerramentos" nunca passa por ela e conserva a grafia que o sync antigo leu da
# coluna MARCA da planilha ('PUKET', 'IMAGINARIUM'). Isso partia o filtro do
# painel em dois grupos para a mesma marca. Normaliza so a GRAFIA — nao decide de
# qual aba a marca vem.
_NORMALIZE_BRAND_SQL = """
    UPDATE cert_products SET brand = %s, updated_at = NOW()
    WHERE LOWER(REPLACE(brand, '_', ' ')) = %s AND brand <> %s
"""

# O codigo de barras que a coluna SKU da aba "Encerramentos" traz em algumas
# linhas virou produto no banco antes de existir a traducao EAN -> SKU. Agora que
# a linha entra com o codigo de produto correto, a linha antiga fica orfa: mesmo
# produto, chave errada, sem encerramento e com o texto velho. Remove apenas os
# codigos que ACABARAM de ser resolvidos nesta rodada — nunca por formato.
_DELETE_EAN_ORFAOS_SQL = """
    DELETE FROM cert_products
    WHERE sku = ANY(%s) AND sku NOT IN (SELECT unnest(%s::text[]))
"""

_CLEAR_ENCERRAMENTOS_SQL = """
    UPDATE cert_products
    SET sale_deadline = NULL, sale_deadline_date = NULL,
        encerramento_status = NULL, is_expired = FALSE, updated_at = NOW()
    WHERE NOT (sku = ANY(%s))
      AND (sale_deadline IS NOT NULL
           OR sale_deadline_date IS NOT NULL
           OR encerramento_status IS NOT NULL
           OR is_expired = TRUE)
"""


def sync_sheets_to_db() -> dict:
    """Sync certification products from Google Sheets into cert_products table.

    Duas passadas explicitas, em vez do antigo "encerramentos primeiro, ativos
    depois, e o ON CONFLICT que decide": cadastro (abas de produto) e depois
    encerramento (aba "Encerramentos"). Cada passada escreve apenas as colunas
    que a sua aba realmente possui.

    A ordem anterior tinha um efeito colateral silencioso: a linha de "Ativos"
    vinha por ultimo com `is_expired = FALSE` fixo e apagava o vencimento que a
    aba "Encerramentos" tinha acabado de gravar — PI7223Y ficava com
    `is_expired = false` no banco mesmo com prazo 24/07/2026 vencido e a
    planilha dizendo "Vencido - Venda Bloqueada".

    Returns:
        Dict com contadores por passada e opcional 'error'.
    """
    from app.config import DATABASE_URL

    client = _get_sheets_client()
    if not client or not SHEETS_SPREADSHEET_ID:
        return {"synced": 0, "error": "No products found or Sheets not configured"}
    try:
        spreadsheet = client.open_by_key(SHEETS_SPREADSHEET_ID)
    except Exception as e:
        log.error(f"Failed to open spreadsheet: {e}")
        return {"synced": 0, "error": f"Failed to open spreadsheet: {e}"}

    ativos = _read_ativos_from_sheets(spreadsheet)
    encerramentos = _read_encerramentos_from_sheets(spreadsheet)
    if not ativos and not encerramentos:
        return {"synced": 0, "error": "No products found or Sheets not configured"}
    if not DATABASE_URL:
        return {"synced": 0, "error": "Database not configured"}

    try:
        with db() as (conn, cur):
            for p in ativos:
                cur.execute(
                    _UPSERT_ATIVOS_SQL,
                    [
                        p["sku"], p["name"], p["brand"], p["certification_type"],
                        p["numero_certificado"], p["situacao"],
                        # "Texto esperado" e EXCLUSIVAMENTE a coluna V (Descricao
                        # E-commerce). O fallback antigo para certification_type
                        # era o que fazia a coluna do relatorio misturar prazo de
                        # encerramento com o tipo de certificado repetido.
                        p["ecommerce_description"], p["ecommerce_description"],
                        p["sheet_status"],
                    ],
                )
            for e in encerramentos:
                cur.execute(
                    _UPSERT_ENCERRAMENTOS_SQL,
                    [
                        e["sku"], e["name"], e["brand"], e["numero_certificado"],
                        e["sale_deadline"] or None, e["sale_deadline_date"],
                        e["encerramento_status"] or None, e["is_expired"],
                    ],
                )
            # A limpeza SO pode rodar com a aba lida de verdade. `_read_encerramentos_
            # _from_sheets` devolve [] tanto para "aba vazia" quanto para "aba
            # sumiu / erro de leitura", e nesse segundo caso um DELETE-por-ausencia
            # apagaria o prazo e o vencimento de TODOS os produtos por causa de uma
            # falha transitoria do Sheets. Sem linhas, nao se conclui nada.
            if encerramentos:
                skus_enc = [e["sku"] for e in encerramentos]
                cur.execute(_CLEAR_ENCERRAMENTOS_SQL, [skus_enc])
                limpos = cur.rowcount

                # Orfaos de EAN: so os codigos resolvidos nesta rodada, e nunca um
                # que por acaso tambem seja SKU valido de outro produto.
                eans = sorted({e["sku_origem_ean"] for e in encerramentos if e.get("sku_origem_ean")})
                if eans:
                    cur.execute(_DELETE_EAN_ORFAOS_SQL, [eans, skus_enc])
                    if cur.rowcount:
                        log.info(f"Removidos {cur.rowcount} produtos fantasma com EAN no lugar do SKU")
            else:
                limpos = 0
                log.warning(
                    "Aba 'Encerramentos' voltou vazia; limpeza de prazos ignorada "
                    "para nao apagar dado bom por falha de leitura"
                )

            for canonico in sorted(set(_BRAND_CANONICAL.values())):
                cur.execute(_NORMALIZE_BRAND_SQL, [canonico, canonico.lower(), canonico])

        total = len(ativos) + len(encerramentos)
        log.info(
            f"Sync sheets: {len(ativos)} ativos, {len(encerramentos)} encerramentos, "
            f"{limpos} SKUs sem encerramento limpos"
        )
        return {
            "synced": total,
            "total_rows": total,
            "ativos": len(ativos),
            "encerramentos": len(encerramentos),
            "encerramentos_limpos": limpos,
        }
    except Exception as e:
        log.error(f"Failed to sync sheets to DB: {e}")
        return {"synced": 0, "error": str(e)}


def _read_licenciados_from_sheets() -> list[dict]:
    """Read 'Licenciados' worksheet from the shared spreadsheet.

    Returns:
        List of licenciado item dicts.
    """
    client = _get_sheets_client()
    if not client:
        return []
    try:
        spreadsheet = client.open_by_key(SHEETS_SPREADSHEET_ID)
    except Exception as e:
        log.error(f"Failed to open spreadsheet for Licenciados: {e}")
        return []

    try:
        ws = spreadsheet.worksheet("Licenciados")
        rows = ws.get_all_values()
    except gspread.exceptions.WorksheetNotFound:
        log.info("Worksheet 'Licenciados' not found")
        return []
    except Exception as e:
        log.warning(f"Could not read worksheet 'Licenciados': {e}")
        return []

    if not rows or len(rows) < 2:
        return []

    headers = rows[0]
    ncm_col = _find_col_by_header(headers, "ncm")
    process_col = _find_col_by_header(headers, "processo", "process")
    orgao_col = _find_col_by_header(headers, "orgão", "orgao", "órgão")
    supplier_col = _find_col_by_header(headers, "fornecedor", "supplier")
    item_col = _find_col_by_header(headers, "item")
    desc_col = _find_col_by_header(headers, "descrição", "descricao", "description")
    status_col = _find_col_by_header(headers, "status")
    lpco_col = _find_col_by_header(headers, "lpco", "número lpco", "numero lpco")
    valid_col = _find_col_by_header(headers, "validade", "valid_until", "vencimento")

    items: list[dict] = []
    for row in rows[1:]:
        # _row=row default-arg binds the loop variable at function-definition time;
        # this satisfies B023 without relying on late-binding closures.
        def get_val(col_idx: int | None, _row: list = row) -> str:
            if col_idx is None or col_idx >= len(_row):
                return ""
            return str(_row[col_idx]).strip()

        process_code = get_val(process_col)
        if not process_code:
            continue

        valid_str = get_val(valid_col)
        valid_date = None
        if valid_str:
            for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
                try:
                    valid_date = datetime.strptime(valid_str, fmt).date()
                    break
                except ValueError:
                    continue

        items.append({
            "process_code": process_code,
            "ncm": get_val(ncm_col),
            "orgao": get_val(orgao_col),
            "supplier": get_val(supplier_col),
            "item": get_val(item_col),
            "description": get_val(desc_col),
            "status": get_val(status_col) or "pending",
            "lpco_number": get_val(lpco_col),
            "valid_until": valid_date,
        })

    log.info(f"Read {len(items)} licenciados from Google Sheets")
    return items


def read_licenciamentos_vencidos() -> dict[str, dict]:
    """Read the 'Licenciamentos Vencidos' worksheet (expired licenses).

    Esta aba é a FONTE de licenciamento (status + prazo). Não replica dados de
    certificação — alimenta `license_status` e o prazo 'Licen. - Prazo' via
    `derivation.derive_license_status`.

    Layout de colunas assumido (tolerante a variações de cabeçalho; cada coluna
    é localizada por `_find_col_by_header`, não por índice fixo):
        - Processo  : identificador do processo/SKU (ex.: "PI4257Y"). Também
                      aceita cabeçalhos "SKU", "código", "ref".
        - Status    : "VÁLIDO" / "VENCIDO" (ou "Licenciamento Vencido" etc.).
                      Quando ausente, a presença na aba de *vencidos* é tratada
                      como VENCIDO.
        - Validade  : data de expiração do licenciamento ("Validade", "Vencimento",
                      "Prazo", "valid_until"). Parseada nos formatos d/m/Y, ISO etc.

    Returns:
        Dict {PROCESS_CODE/SKU em MAIÚSCULAS -> {"status": "VALIDO"|"VENCIDO",
        "valid_until": <ISO str|None>}}. Vazio quando a aba não existe ou as
        credenciais não estão configuradas (sem crashar).
    """
    client = _get_sheets_client()
    if not client:
        return {}
    try:
        spreadsheet = client.open_by_key(SHEETS_SPREADSHEET_ID)
    except Exception as e:
        log.error(f"Failed to open spreadsheet for Licenciamentos Vencidos: {e}")
        return {}

    try:
        ws = spreadsheet.worksheet("Licenciamentos Vencidos")
        rows = ws.get_all_values()
    except gspread.exceptions.WorksheetNotFound:
        log.info("Worksheet 'Licenciamentos Vencidos' not found, license_status -> NAO_APLICAVEL")
        return {}
    except Exception as e:
        log.warning(f"Could not read worksheet 'Licenciamentos Vencidos': {e}")
        return {}

    if not rows or len(rows) < 2:
        return {}

    headers = rows[0]
    process_col = _find_col_by_header(
        headers, "processo", "process", "produto", "item", "sku", "código", "codigo", "ref"
    )
    status_col = _find_col_by_header(headers, "status", "situação", "situacao")
    valid_col = _find_col_by_header(
        headers, "validade", "vencimento", "valid_until", "prazo", "data"
    )

    if process_col is None:
        log.warning("Worksheet 'Licenciamentos Vencidos': missing process/SKU column")
        return {}

    result: dict[str, dict] = {}
    for row in rows[1:]:
        if process_col >= len(row):
            continue
        raw_code = str(row[process_col]).strip()
        if not raw_code:
            continue

        status_str = (
            str(row[status_col]).strip()
            if status_col is not None and status_col < len(row)
            else ""
        )
        status_low = status_str.lower()
        # Aba de *vencidos*: default VENCIDO quando o status não diz "válido".
        if "venc" in status_low or "expir" in status_low:
            status = "VENCIDO"
        elif "vál" in status_low or "val" in status_low or "ativo" in status_low:
            status = "VALIDO"
        else:
            status = "VENCIDO"

        valid_str = (
            str(row[valid_col]).strip()
            if valid_col is not None and valid_col < len(row)
            else ""
        )
        valid_iso: str | None = None
        if valid_str:
            for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
                try:
                    valid_iso = datetime.strptime(valid_str, fmt).date().isoformat()
                    break
                except ValueError:
                    continue
            if valid_iso is None:
                # Mantém o texto original quando não parseável (ex.: "Fim do lote").
                valid_iso = valid_str

        for code in re.split(r"[\r\n]+", raw_code):
            code = code.strip()
            if not code:
                continue
            result[code.upper()] = {"status": status, "valid_until": valid_iso}

    log.info(f"Read {len(result)} expired-license rows from 'Licenciamentos Vencidos'")
    return result


def safe_license_map() -> dict[str, dict]:
    """Le o mapa de "Licenciamentos Vencidos" sem nunca propagar erro do Sheets.

    Painel e relatorio precisam do mesmo mapa para derivar `license_status`, e
    nenhum dos dois pode cair porque a planilha ficou indisponivel — sem o mapa o
    status apenas defauta para NAO_APLICAVEL.
    """
    if not SHEETS_CLIENT_EMAIL or not SHEETS_PRIVATE_KEY:
        return {}
    try:
        return read_licenciamentos_vencidos()
    except Exception as e:
        log.warning(f"Could not load Licenciamentos Vencidos map: {e}")
        return {}


def sync_licenciados_to_db() -> dict:
    """Sync Licenciados from Google Sheets into li_tracking table.

    Returns:
        Dict with 'synced' count and optional 'error' key.
    """
    from app.config import DATABASE_URL
    from app.db.postgres import ensure_li_tracking_table

    items = _read_licenciados_from_sheets()
    if not items:
        return {"synced": 0, "error": "No licenciados found or Sheets not configured"}
    if not DATABASE_URL:
        return {"synced": 0, "error": "Database not configured"}

    ensure_li_tracking_table()

    _INSERT_SQL = """
        INSERT INTO li_tracking
            (process_id, process_code, ncm, orgao, supplier, item,
             description, status, lpco_number, valid_until, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT ON CONSTRAINT li_tracking_process_code_ncm_item_key
        DO UPDATE SET
            process_id = COALESCE(EXCLUDED.process_id, li_tracking.process_id),
            orgao = COALESCE(NULLIF(EXCLUDED.orgao, ''), li_tracking.orgao),
            supplier = COALESCE(NULLIF(EXCLUDED.supplier, ''), li_tracking.supplier),
            description = COALESCE(NULLIF(EXCLUDED.description, ''), li_tracking.description),
            status = COALESCE(NULLIF(EXCLUDED.status, ''), li_tracking.status),
            lpco_number = COALESCE(NULLIF(EXCLUDED.lpco_number, ''), li_tracking.lpco_number),
            valid_until = COALESCE(EXCLUDED.valid_until, li_tracking.valid_until),
            updated_at = NOW()
    """

    def _do_sync(process_map: dict) -> int:
        synced = 0
        with db() as (conn, cur):
            for item in items:
                process_id = process_map.get(item["process_code"])
                cur.execute(
                    _INSERT_SQL,
                    [
                        process_id, item["process_code"], item["ncm"], item["orgao"],
                        item["supplier"], item["item"], item["description"],
                        item["status"], item["lpco_number"], item["valid_until"],
                    ],
                )
                synced += 1
        return synced

    try:
        with db() as (conn, cur):
            cur.execute("SELECT id, process_code FROM import_processes")
            process_map = {r["process_code"]: r["id"] for r in cur.fetchall()}
        return {"synced": _do_sync(process_map), "total_rows": len(items)}
    except Exception as e:
        log.error(f"Failed to sync licenciados to DB: {e}")
        if "li_tracking_process_code_ncm_item_key" in str(e):
            try:
                with db() as (conn, cur):
                    cur.execute(
                        "ALTER TABLE li_tracking ADD CONSTRAINT li_tracking_process_code_ncm_item_key UNIQUE (process_code, ncm, item)"
                    )
                with db() as (conn, cur):
                    cur.execute("SELECT id, process_code FROM import_processes")
                    process_map = {r["process_code"]: r["id"] for r in cur.fetchall()}
                return {
                    "synced": _do_sync(process_map),
                    "total_rows": len(items),
                    "note": "constraint created and retried",
                }
            except Exception as retry_err:
                log.error(f"Retry after constraint creation failed: {retry_err}")
        return {"synced": 0, "error": str(e)}
