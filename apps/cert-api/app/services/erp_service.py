"""Google Sheets sync services for certifications and licenciados."""

import re
from collections import defaultdict
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials

from app.config import SHEETS_CLIENT_EMAIL, SHEETS_PRIVATE_KEY, SHEETS_SPREADSHEET_ID
from app.db.postgres import db
from app.services.derivation import (
    _today_sp,
    derive_situacao_status,
    derive_venda_encerramento,
    parse_data_real,
)
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

# Abas "Imaginarium" e "Puket" compartilham o mesmo layout A..W. O indice e so
# FALLBACK: quem manda e o cabecalho (`_resolve_columns`), porque a planilha ganha
# colunas novas sem aviso — foi o que aconteceu na aba "Encerramentos" em 09/2026.
_LAYOUT_MARCA = {
    "sku": (("código", "codigo"), 2),                                       # C
    "name": (("nome",), 5),                                                 # F
    "certification_type": (("tipo de certificação", "tipo de certificacao"), 7),  # H
    "sheet_status": (("status",), 9),                                       # J
    # Validade da certificacao (reuniao 11/09): e ela que diz se o certificado
    # esta vivo, e NAO e data de trava de venda.
    "validade_certificado": (
        ("validade da certificação", "validade da certificacao"),
        13,
    ),                                                                      # N
    "numero_certificado": (("número certificado", "numero certificado"), 15),     # P
    "situacao": (("situação", "situacao"), 20),                             # U
    "ecommerce_description": (_DESC_ECOMMERCE_HEADERS, 21),                 # V
}

# A aba "Puket escolares" foi ABANDONADA na reuniao de 11/09/2026: os 167 SKUs
# migraram para a aba "Puket" e a planilha nao a atualiza mais. Enquanto ela era
# lida — e por ultimo no laco — o upsert gravava brand='Puket Escolares' e
# situacao='' POR CIMA do U='Ativo' que a aba Puket acabara de trazer (o layout
# escolar nao tem coluna U), deixando 167 itens ativos sem status. Os aliases de
# marca continuam em `_BRAND_CANONICAL`, VTEX_STORES e LINX_BRANDS para nao
# quebrar historico; so a LEITURA da aba saiu.
_ATIVOS_SHEETS = (
    {"name": "Imaginarium", "brand": "Imaginarium", "fields": _LAYOUT_MARCA},
    {"name": "Puket", "brand": "Puket", "fields": _LAYOUT_MARCA},
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

# Motivos de pendencia por SKU devolvidos pelo sync do painel (`pendencias`).
_PENDENCIA_VINCULO = "mais de um fornecedor/certificado para o mesmo SKU"
_PENDENCIA_CERTIFICADO_DIVERGENTE = (
    "certificado da aba da marca difere do de Encerramentos e nao ha linha ativa"
)
_PENDENCIA_ATIVO_E_ENCERRADO = (
    "aba da marca diz Ativo e Encerramentos encerra o mesmo certificado"
)
# Teto de SKUs nomeados numa mensagem de erro e de pendencias gravadas no
# `result` do sync (jsonb de `cert_sync_runs`).
_MAX_SKUS_NA_MENSAGEM = 20
_MAX_PENDENCIAS_NO_RESULTADO = 200

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


def _find_col_by_header(headers: list[str], *candidates: str, contexto: str = "") -> int | None:
    """Find a column index by matching header text (case-insensitive).

    Faz duas passadas: primeiro cabeçalho IDÊNTICO ao candidato, depois
    substring. A passada exata evita o falso positivo clássico da aba
    "Puket escolares", onde procurar por "certificado" achava
    "NOME COMERCIAL (CERTIFICADO)" (coluna B) antes da coluna "CERTIFICADO" (D).

    Args:
        headers: List of header strings from the first row.
        *candidates: Header names to search for (exact first, then substring).
        contexto: rótulo "aba/campo" usado só no aviso de casamento por
            substring. Um cabeçalho que deixou de bater por igualdade é o
            sintoma de RENOMEAÇÃO na planilha — e ler a coluna errada calado é
            exatamente o risco que a reunião levantou sobre a coluna nova em
            "Encerramentos". Sem contexto, não loga (uso interno/teste).

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
                if contexto:
                    log.warning(
                        f"{contexto}: nenhum cabecalho igual a {wanted}; usando "
                        f"'{headers[i]}' (coluna {i}) por aproximacao. Confira se a "
                        f"planilha renomeou a coluna."
                    )
                return i
    return None


def _resolve_columns(headers: list[str], fields: dict, sheet_name: str) -> dict[str, int | None]:
    """Resolve cada campo por cabecalho exato e unico, sem fallback posicional.

    Args:
        headers: primeira linha da aba.
        fields: {campo: (candidatos_de_cabecalho, indice_fallback)}.
        sheet_name: nome da aba (só para log).

    Returns:
        {campo: índice 0-based ou None quando a coluna não existe na aba}.
    """
    resolved: dict[str, int | None] = {}
    for field, (candidates, fallback) in fields.items():
        normalized = [str(header).strip().lower() for header in headers]
        matches = [i for i, header in enumerate(normalized) if header in candidates]
        idx = matches[0] if len(matches) == 1 else None
        if idx is None:
            log.warning(f"Aba {sheet_name}: cabecalho ausente para {field}; sem fallback posicional")
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


def _bulk_source_spreadsheet():
    """Open the configured source; incomplete reads cannot prepare a load."""
    client = _get_sheets_client()
    if not client or not SHEETS_SPREADSHEET_ID:
        raise ValueError("Sheets nao configurado; preparacao da carga indisponivel")
    try:
        return client.open_by_key(SHEETS_SPREADSHEET_ID)
    except Exception:
        raise ValueError("Fonte Sheets indisponivel; preparacao da carga interrompida") from None


def read_encerramentos_prazos() -> list[dict]:
    """Read the load source using the same strict schema gates as the main sync.

    Keep rows without deadlines visible; missing data is not an empty success.
    Raw double-certification information is evidence, not approved association.
    """
    rows = _read_encerramentos_from_sheets(_bulk_source_spreadsheet(), strict=True)
    if not rows or any(not row.get("brand") for row in rows):
        raise ValueError("Encerramentos incompleto: confirmar dados e marca de cada SKU")
    return [{**row, "certificado": row.get("numero_certificado", "")} for row in rows]


def read_situacao_por_sku() -> dict[str, dict]:
    """Read current supplier/certificate identities; never resolve ambiguity by date."""
    rows = _read_ativos_from_sheets(_bulk_source_spreadsheet(), strict=True)
    return {row["sku"]: row for row in rows}


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
            log.warning(f"Nao foi possivel resolver EAN->SKU da marca '{brand}': {type(e).__name__}")
            # Linx fora do ar: o codigo cru NAO e um SKU e o SKU verdadeiro e
            # desconhecido nesta rodada. Quem consome precisa saber — ver
            # `sync_sheets_to_db`, que nao grava a linha nem roda a limpeza.
            for it in items:
                if it.get("brand") == brand and it.get("sku", "").strip() in codes:
                    it["ean_nao_resolvido"] = True
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


def _linha_vigente(linhas: list[dict]) -> dict:
    """Escolhe, entre linhas do MESMO SKU, a que vale hoje (dupla certificacao).

    O mesmo SKU aparece duas vezes quando o produto foi recertificado: o
    certificado antigo com U='Encerrado' e o novo com U='Ativo' (caso PI6552Y,
    PELUCIA NEVINHO G: 8325/2022-BRI-1 encerrado + 10473/2024-BRI-1 ativo). A
    reuniao [46:21] decidiu: "vale o ultimo valido/ativo".

    Antes quem decidia era a ORDEM das linhas — o upsert e last-write-wins, e o
    resultado certo em producao era acidente de ordenacao. Aqui a escolha e
    deterministica: linha com U='Ativo' vence; entre iguais, a ULTIMA (a planilha
    e append-only, a mais recente fica embaixo).

    Args:
        linhas: linhas lidas das abas de produto para um mesmo SKU, na ordem da
            planilha. Nunca vazia.

    Returns:
        A linha vigente.
    """
    ativas = [ln for ln in linhas if derive_situacao_status(ln.get("situacao")) == "ATIVO"]
    return (ativas or linhas)[-1]


def _vinculos_ambiguos(por_sku: dict[str, list[dict]]) -> list[dict]:
    """SKUs cujas linhas candidatas apontam para mais de um fornecedor/certificado.

    Candidatas sao as linhas U='Ativo' do SKU ou, sem nenhuma ativa, todas. Em
    18/09/2026 eram 4 SKUs reais, todos com DOIS certificados encerrados e nenhum
    ativo (PI4368Y, PI6014Y, 100400422, 100400423).

    Returns:
        Uma pendencia por SKU, com os certificados envolvidos, na ordem da planilha.
    """
    pendencias: list[dict] = []
    for sku, linhas in por_sku.items():
        ativas = [p for p in linhas if derive_situacao_status(p.get("situacao")) == "ATIVO"]
        candidatas = ativas or linhas
        identidades = {
            (p.get("brand"), p.get("supplier"), _norm_certificado(p.get("numero_certificado")))
            for p in candidatas
        }
        if len(identidades) > 1:
            pendencias.append({
                "sku": sku,
                "motivo": _PENDENCIA_VINCULO,
                "certificados": list(dict.fromkeys(
                    _norm_certificado(p.get("numero_certificado")) for p in candidatas
                )),
            })
    return pendencias


def _read_ativos_from_sheets(
    spreadsheet: gspread.Spreadsheet,
    *,
    strict: bool = False,
    pendencias: list[dict] | None = None,
) -> list[dict]:
    """Le o cadastro de certificacao das abas de produto ativo.

    Cobre "Imaginarium" e "Puket" (a aba "Puket escolares" foi abandonada — ver
    `_ATIVOS_SHEETS`). Cada campo e localizado pelo CABECALHO, com o indice do
    layout apenas como referencia para diagnostico.

    A MARCA vem da ABA, nunca da coluna A: ver `_BRAND_CANONICAL` (caso
    100400496 / 'Kayuan').

    Vinculo ambiguo (ver `_vinculos_ambiguos`) e problema de UM SKU, nao da
    planilha. Com `pendencias` informado, o SKU entra na lista e segue pela
    regra deterministica de `_linha_vigente`; o restante da planilha sincroniza.
    Sem `pendencias` (preparacao da carga do Linx) a leitura continua recusando
    tudo, mas nomeando os SKUs. De 12/09 a 18/09/2026 o `raise` sem essa
    separacao derrubou 145 de 145 sincronizacoes do painel por causa de 4 SKUs.

    Returns:
        Lista de dicts de cadastro, UM POR SKU: linhas repetidas do mesmo SKU
        (dupla certificacao) sao resolvidas por `_linha_vigente`.
    """
    produtos: list[dict] = []
    for cfg in _ATIVOS_SHEETS:
        try:
            ws = spreadsheet.worksheet(cfg["name"])
            rows = ws.get_all_values()
        except Exception as e:
            if strict:
                raise ValueError(f"Leitura incompleta da aba {cfg['name']}") from None
            log.warning(f"Could not read worksheet '{cfg['name']}': {type(e).__name__}")
            continue
        if not rows:
            if strict:
                raise ValueError(f"Aba {cfg['name']} sem cabecalho; sincronizacao nao aplicada")
            continue

        cols = _resolve_columns(rows[0], cfg["fields"], cfg["name"])
        # TODOS os campos do layout, nao so os quatro de identidade: o upsert
        # atribui direto (sem COALESCE), entao uma coluna nao localizada — cabecalho
        # renomeado ou DUPLICADO — gravaria '' na marca inteira. Um segundo
        # "STATUS" na aba apagaria `sheet_status` e o "SKU excluido" voltaria a
        # aparecer como vendavel. Problema de esquema e da aba, nao de um SKU:
        # aqui recusar tudo e o correto, e a mensagem diz qual cabecalho conferir.
        if strict:
            faltando = sorted(field for field in cfg["fields"] if cols.get(field) is None)
            if faltando:
                rotulos = ", ".join(f"'{cfg['fields'][f][0][0]}'" for f in faltando)
                raise ValueError(
                    f"Esquema de certificacao incompleto na aba {cfg['name']}: "
                    f"cabecalho ausente ou duplicado: {rotulos}"
                )
        if strict and not any(_cell(row, cols["sku"]) for row in rows[1:]):
            raise ValueError(f"Aba {cfg['name']} com cabecalho mas sem dados; confirmar carga vazia")
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
                validade_raw = _cell(row, cols.get("validade_certificado"))
                validade = parse_data_real(validade_raw)
                produtos.append({
                    "sku": sku,
                    "supplier": _cell(row, _find_col_by_header(rows[0], "fornecedor")),
                    "name": _cell(row, cols["name"]),
                    "brand": cfg["brand"],
                    "certification_type": _cell(row, cols["certification_type"]),
                    "numero_certificado": _cell(row, cols["numero_certificado"]),
                    "situacao": _cell(row, cols["situacao"]),
                    "sheet_status": _cell(row, cols["sheet_status"]),
                    "ecommerce_description": _cell(row, cols["ecommerce_description"]),
                    "validade_certificado_raw": validade_raw,
                    "validade_certificado": validade.isoformat() if validade else None,
                })

    por_sku: dict[str, list[dict]] = defaultdict(list)
    for p in produtos:
        por_sku[p["sku"]].append(p)
    if strict:
        ambiguos = _vinculos_ambiguos(por_sku)
        if ambiguos and pendencias is None:
            skus = ", ".join(a["sku"] for a in ambiguos[:_MAX_SKUS_NA_MENSAGEM])
            resto = len(ambiguos) - _MAX_SKUS_NA_MENSAGEM
            raise ValueError(
                "Vinculo de certificacao ambiguo; validar fornecedor e certificado antes da "
                f"sincronizacao: {skus}" + (f" e mais {resto}" if resto > 0 else "")
            )
        if ambiguos:
            pendencias.extend(ambiguos)
    vigentes = [_linha_vigente(linhas) for linhas in por_sku.values()]
    duplicados = len(produtos) - len(vigentes)
    if duplicados:
        log.info(
            f"Ativos: {duplicados} linha(s) repetida(s) de SKU resolvidas pela "
            f"situacao (dupla certificacao)"
        )
    log.info(f"Ativos: {len(vigentes)} SKUs lidos das abas de produto")
    return vigentes


def _read_encerramentos_from_sheets(
    spreadsheet: gspread.Spreadsheet, *, strict: bool = False, exigir_dupla: bool = True
) -> list[dict]:
    """Le a aba "Encerramentos" — prazo final de venda e permissao de venda.

    A leitura e SEMPRE por CABECALHO, nunca por letra de coluna: em 09/2026 a
    planilha inseriu 'DATA LEMBRETE - TRANSF. ESTOQUE' no meio e todas as colunas
    seguintes andaram uma casa. Cabecalhos usados (conferidos em 11/09/2026):
        'CERTIFICADO' | 'SKU' | 'NOME' | 'PRAZO FINAL VENDA' | 'STATUS' | 'MARCA'
    Os lembretes ('DATA LEMBRETE- FIM VENDA', 'DATA LEMBRETE - TRANSF. ESTOQUE')
    NAO sao prazo e nunca podem ser lidos como tal.

    'STATUS' e o veredito do time fiscal ("Comerciacao Permitida" /
    "Vencido - Venda Bloqueada" / "Venda ate fim do lote"). A leitura antiga
    exigia data no prazo e por isso DESCARTAVA as 28 linhas que so tem o
    status — entre elas PI7560Y, que aparecia no painel como Encerrado / Nao
    conforme sem ter prazo nenhum. Basta prazo, status OU certificado identificado:
    mesmo sem prazo/status, o encerramento identificado precisa chegar ao resolver
    e a derivacao para sinalizar pendencia, sem liberar o SKU pela limpeza.

    Returns:
        Lista de dicts de encerramento, um por SKU.
    """
    try:
        ws = spreadsheet.worksheet("Encerramentos")
        rows = ws.get_all_values()
    except gspread.exceptions.WorksheetNotFound:
        if strict:
            raise ValueError("Aba Encerramentos indisponivel") from None
        log.info("Worksheet 'Encerramentos' not found, skipping")
        return []
    except Exception as e:
        if strict:
            raise ValueError("Leitura incompleta de Encerramentos") from None
        log.warning(f"Error reading 'Encerramentos' worksheet: {type(e).__name__}")
        return []

    if not rows:
        if strict:
            raise ValueError("Aba Encerramentos sem cabecalho; sincronizacao nao aplicada")
        return []

    headers = rows[0]
    if strict:
        normalized = [str(header).strip().lower() for header in headers]
        # 'Dupla certificação?' e evidencia para a carga do Linx, nao fonte do
        # painel: renomear essa coluna nao pode derrubar o sync de todo mundo.
        obrigatorios = ("sku", "certificado", "prazo final venda", "status")
        if exigir_dupla:
            obrigatorios += ("dupla certificação?",)
        for required in obrigatorios:
            if normalized.count(required) != 1:
                raise ValueError(f"Esquema de Encerramentos invalido: {required}")
    if strict and not any(_cell(row, normalized.index("sku")) for row in rows[1:]):
        raise ValueError("Aba Encerramentos com cabecalho mas sem dados; confirmar carga vazia")
    ctx = "Aba 'Encerramentos'"
    i_sku = _find_col_by_header(headers, "sku", "código", "codigo", "ref", contexto=f"{ctx} / sku")
    i_prazo = _find_col_by_header(
        headers, "prazo final venda", "prazo final", "prazo venda", contexto=f"{ctx} / prazo"
    )
    i_status = _find_col_by_header(
        headers, "status", "situação", "situacao", contexto=f"{ctx} / status"
    )
    i_marca = _find_col_by_header(headers, "marca", "brand", contexto=f"{ctx} / marca")
    i_cert = _find_col_by_header(headers, "certificado", contexto=f"{ctx} / certificado")
    i_nome = _find_col_by_header(headers, "nome", "produto", "descrição", "descricao")
    i_dupla = _find_col_by_header(
        headers, "dupla certificação", "dupla certificacao", "dupla certificação?", "dupla certificacao?"
    )
    if i_sku is None:
        log.warning("Aba 'Encerramentos' sem coluna de SKU; ignorada")
        return []

    # Fuso de negocio explicito, nao o do processo: `datetime.now().date()` num
    # container UTC vira o dia SEGUINTE as 21:00 de Brasilia, e o `prazo_date <
    # today` abaixo marcava como vencido um prazo que ainda valia por 3 horas.
    # Mesmo defeito de derivation.py:82. Nao depender do `TZ` do container e
    # deliberado: o TZ conserta o caso, mas some se alguem remover a variavel.
    today = _today_sp()
    out: list[dict] = []
    for row in rows[1:]:
        raw_sku = _cell(row, i_sku)
        if not raw_sku:
            continue
        prazo_str = _cell(row, i_prazo)
        status_str = _cell(row, i_status)
        certificado_str = _cell(row, i_cert)
        if not prazo_str and not status_str and not certificado_str:
            continue

        prazo_date = parse_data_real(prazo_str)

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
                "numero_certificado": certificado_str,
                "sale_deadline": prazo_str,
                "sale_deadline_date": prazo_date.isoformat() if prazo_date else None,
                "encerramento_status": status_str,
                "dupla_certificacao_raw": _cell(row, i_dupla),
                "is_expired": is_expired,
            })

    _resolve_ean_skus(out)
    bloqueados = sum(1 for e in out if e["is_expired"])
    sem_prazo = sum(1 for e in out if not e["sale_deadline"])
    log.info(
        f"Encerramentos: {len(out)} SKUs ({bloqueados} com venda bloqueada, "
        f"{sem_prazo} sem data em 'PRAZO FINAL VENDA')"
    )
    return out


def resolver_encerramentos(
    ativos: list[dict], encerramentos: list[dict]
) -> tuple[list[dict], list[dict]]:
    """Separa o encerramento que VALE do que e historico (dupla certificacao).

    Um SKU com certificado ATIVO nao pode herdar o prazo de venda do certificado
    ANTERIOR. Era o que acontecia: toda linha de "Encerramentos" era aplicada ao
    SKU sem olhar o numero do certificado, e o PI6552Y (ativo pelo 10473/2024)
    ficava com prazo 29/10/2026 do 8325/2022 — prazo que ate chegava ao Linx como
    trava de um certificado vivo.

    Regras (decisao D11):
    - SKU com linha vigente U='Ativo': encerramento de OUTRO certificado e
      historico; o `_CLEAR_ENCERRAMENTOS_SQL` limpa o prazo antigo. Encerramento
      do MESMO certificado e preservado e sinalizado como pendencia no sync.
    - SKU sem linha ativa: o encerramento vale. Havendo mais de uma linha,
      prefere a do MESMO certificado da linha de produto (col. A = col. P); sem
      casar, mantem a ultima (comportamento anterior).
    - A coluna 'Dupla certificação?' NAO e usada como fonte: em 11/09 estava
      vazia nas 399 linhas. Quando for preenchida serve de conferencia.

    Args:
        ativos: saida de `_read_ativos_from_sheets` (uma linha por SKU).
        encerramentos: saida de `_read_encerramentos_from_sheets`.

    Returns:
        Tupla (aplicaveis, historicos).
    """
    vigente_por_sku = {p["sku"]: p for p in ativos}
    por_sku: dict[str, list[dict]] = defaultdict(list)
    for e in encerramentos:
        por_sku[e["sku"]].append(e)

    aplicaveis: list[dict] = []
    historicos: list[dict] = []
    for sku, linhas in por_sku.items():
        vigente = vigente_por_sku.get(sku)
        if vigente and derive_situacao_status(vigente.get("situacao")) == "ATIVO":
            # Historico e o encerramento de OUTRO certificado. Se "Encerramentos"
            # encerra o MESMO certificado que a aba da marca ainda diz 'Ativo', as
            # duas abas se contradizem (coluna U nao atualizada): descartar a linha
            # a tiraria da lista protegida da limpeza e o item de venda bloqueada
            # sairia liberado. Vale o encerramento; o sync lista a pendencia.
            cert_vigente = _norm_certificado(vigente.get("numero_certificado"))
            mesmo_certificado = [
                ln for ln in linhas if cert_vigente and _norm_certificado(ln.get("numero_certificado")) == cert_vigente
            ]
            if mesmo_certificado:
                aplicaveis.append(mesmo_certificado[-1])
            historicos.extend(ln for ln in linhas if not mesmo_certificado or ln is not mesmo_certificado[-1])
            continue
        escolhida = linhas[-1]
        if vigente and len(linhas) > 1:
            cert_vigente = _norm_certificado(vigente.get("numero_certificado"))
            mesma = [
                ln for ln in linhas if cert_vigente and _norm_certificado(ln.get("numero_certificado")) == cert_vigente
            ]
            if mesma:
                escolhida = mesma[-1]
        aplicaveis.append(escolhida)
        historicos.extend([ln for ln in linhas if ln is not escolhida])

    if historicos:
        log.info(
            f"Encerramentos: {len(historicos)} linha(s) ignorada(s) como historico "
            f"(certificado ativo ou dupla certificacao)"
        )
    return aplicaveis, historicos


def _norm_certificado(valor: object) -> str:
    """Normaliza o numero do certificado para comparar entre abas."""
    return re.sub(r"\s+", "", str(valor or "")).upper()


# SQL do cadastro (abas de produto). Os campos que a planilha controla sao
# atribuidos DIRETAMENTE, sem COALESCE: quando a celula esvazia, o portal tem de
# esvaziar junto. Era o COALESCE que deixava `expected_cert_text` e
# `certification_type` carregando texto velho ("ENCERRAMENTO - Prazo: ...")
# depois que a planilha ja tinha corrigido a linha.
_UPSERT_ATIVOS_SQL = """
    INSERT INTO cert_products
        (sku, name, brand, certification_type, numero_certificado, situacao,
         expected_cert_text, ecommerce_description, sheet_status,
         validade_certificado, validade_certificado_raw, updated_at)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    ON CONFLICT (sku) DO UPDATE SET
        name = COALESCE(NULLIF(EXCLUDED.name, ''), cert_products.name),
        brand = COALESCE(NULLIF(EXCLUDED.brand, ''), cert_products.brand),
        certification_type = EXCLUDED.certification_type,
        numero_certificado = EXCLUDED.numero_certificado,
        situacao = EXCLUDED.situacao,
        expected_cert_text = EXCLUDED.expected_cert_text,
        ecommerce_description = EXCLUDED.ecommerce_description,
        sheet_status = EXCLUDED.sheet_status,
        -- Atribuicao direta (sem COALESCE): quando a planilha apaga a validade,
        -- o portal tem de apagar junto, senao sobra data de um certificado que
        -- nao existe mais.
        validade_certificado = EXCLUDED.validade_certificado,
        validade_certificado_raw = EXCLUDED.validade_certificado_raw,
        updated_at = NOW()
"""

# SQL do encerramento. Roda DEPOIS do cadastro e so mexe nos campos que a aba
# "Encerramentos" possui. name/brand/numero_certificado sao preenchidos apenas
# quando o cadastro nao trouxe nada (SKU que so existe em encerramentos).
_UPSERT_ENCERRAMENTOS_SQL = """
    INSERT INTO cert_products
        (sku, name, brand, numero_certificado, sale_deadline, sale_deadline_date,
         encerramento_status, is_expired, encerramento_numero_certificado, updated_at)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
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
        encerramento_numero_certificado = EXCLUDED.encerramento_numero_certificado,
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
        encerramento_status = NULL, is_expired = FALSE,
        encerramento_numero_certificado = NULL, updated_at = NOW()
    WHERE NOT (sku = ANY(%s))
      AND (sale_deadline IS NOT NULL
           OR sale_deadline_date IS NOT NULL
           OR encerramento_status IS NOT NULL
           OR is_expired = TRUE
           OR encerramento_numero_certificado IS NOT NULL)
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

    pendencias: list[dict] = []
    try:
        ativos = _read_ativos_from_sheets(spreadsheet, strict=True, pendencias=pendencias)
        encerramentos_lidos = _read_encerramentos_from_sheets(
            spreadsheet, strict=True, exigir_dupla=False
        )
    except ValueError as exc:
        return {"synced": 0, "error": str(exc)}
    # EAN que o Linx nao pode traduzir NESTA rodada (Linx fora do ar): o codigo
    # cru viraria produto fantasma e, pior, o SKU verdadeiro ficaria fora de
    # `skus_enc` — a limpeza abaixo apagaria prazo e `is_expired` de um item de
    # venda BLOQUEADA. A linha nao e gravada e a limpeza nao roda; o proximo sync
    # com o Linx no ar resolve.
    eans_pendentes = [e["sku"] for e in encerramentos_lidos if e.get("ean_nao_resolvido")]
    if eans_pendentes:
        encerramentos_lidos = [e for e in encerramentos_lidos if not e.get("ean_nao_resolvido")]
    # Texto na coluna de prazo que nao e data nem veredito conhecido vira "sem
    # prazo" calado. `get_all_values` entrega o valor FORMATADO: trocar o formato
    # da coluna na planilha (ex. "out/26") zeraria todas as travas sem erro.
    prazos_ilegiveis = [
        e["sku"]
        for e in encerramentos_lidos
        if e.get("sale_deadline")
        and not e.get("sale_deadline_date")
        and derive_venda_encerramento(e["sale_deadline"]) is None
        and derive_venda_encerramento(e.get("encerramento_status")) is None
    ]
    # Encerramento de certificado ANTIGO nao pode travar SKU com certificado
    # ativo (dupla certificacao) — ver `resolver_encerramentos`. Esse caso esta
    # DECIDIDO (reuniao 11/09, "vale o ativo") e nao e pendencia. Pendencia e o
    # SKU SEM linha ativa cujo certificado na aba da marca nao e o de
    # "Encerramentos": o prazo do encerramento continua valendo (lado
    # conservador) e o SKU e listado para o time conferir.
    encerramentos, historicos = resolver_encerramentos(ativos, encerramentos_lidos)
    por_sku = {p["sku"]: p for p in ativos}
    ja_pendentes = {p["sku"] for p in pendencias}
    for e in encerramentos:
        produto = por_sku.get(e["sku"])
        if not produto or e["sku"] in ja_pendentes:
            continue
        atual = _norm_certificado(produto.get("numero_certificado"))
        antigo = _norm_certificado(e.get("numero_certificado"))
        if atual and antigo and atual != antigo:
            pendencias.append({
                "sku": e["sku"],
                "motivo": _PENDENCIA_CERTIFICADO_DIVERGENTE,
                "certificados": [atual, antigo],
            })
        elif atual and atual == antigo and derive_situacao_status(produto.get("situacao")) == "ATIVO":
            pendencias.append({
                "sku": e["sku"],
                "motivo": _PENDENCIA_ATIVO_E_ENCERRADO,
                "certificados": [atual],
            })
    if not ativos and not encerramentos_lidos:
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
                        p.get("validade_certificado"),
                        p.get("validade_certificado_raw") or None,
                    ],
                )
            for e in encerramentos:
                cur.execute(
                    _UPSERT_ENCERRAMENTOS_SQL,
                    [
                        e["sku"], e["name"], e["brand"], e["numero_certificado"],
                        e["sale_deadline"] or None, e["sale_deadline_date"],
                        e["encerramento_status"] or None, e["is_expired"],
                        e.get("numero_certificado") or None,
                    ],
                )
            # A limpeza SO pode rodar com a aba lida de verdade. `_read_encerramentos_
            # _from_sheets` devolve [] tanto para "aba vazia" quanto para "aba
            # sumiu / erro de leitura", e nesse segundo caso um DELETE-por-ausencia
            # apagaria o prazo e o vencimento de TODOS os produtos por causa de uma
            # falha transitoria do Sheets. Sem linhas, nao se conclui nada.
            if eans_pendentes:
                limpos = 0
                log.warning(
                    f"{len(eans_pendentes)} EAN(s) sem traducao (Linx indisponivel); "
                    "linhas nao gravadas e limpeza de prazos adiada para o proximo sync"
                )
            elif encerramentos_lidos:
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
            f"Sync sheets: {len(ativos)} ativos, {len(encerramentos)} encerramentos "
            f"aplicados ({len(historicos)} historicos), {limpos} SKUs sem encerramento limpos"
        )
        if pendencias:
            log.warning(
                f"Sync sheets: {len(pendencias)} SKU(s) com vinculo de certificado a conferir: "
                + ", ".join(p["sku"] for p in pendencias[:_MAX_SKUS_NA_MENSAGEM])
            )
        return {
            "synced": total,
            "total_rows": total,
            "ativos": len(ativos),
            "encerramentos": len(encerramentos),
            "encerramentos_limpos": limpos,
            "skus_dupla_certificacao": len({h["sku"] for h in historicos}),
            "pendencias_total": len(pendencias),
            "pendencias": pendencias[:_MAX_PENDENCIAS_NO_RESULTADO],
            "eans_nao_resolvidos": eans_pendentes[:_MAX_PENDENCIAS_NO_RESULTADO],
            "prazos_ilegiveis": prazos_ilegiveis[:_MAX_PENDENCIAS_NO_RESULTADO],
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
    """Mapa de licenciamento para o painel e o relatorio — hoje sempre vazio.

    Decisao D11 (reuniao 11/09, [58:01]): a aba "Licenciamentos Vencidos" NAO
    sera mais atualizada; o time de produto lanca o licenciamento direto no Linx,
    e a fonte passa a ser a propriedade 00107/00225 (coluna
    `cert_products.linx_fim_licenciamento`, consumida por
    `derivation.derive_license_status_linx`).

    A funcao continua existindo, e continua sendo o unico ponto de entrada do
    mapa, para a virada de fonte ser de UMA linha: quem chama nao muda. Ler uma
    aba congelada seria pior que nao ler — ela envelhece e passa a contradizer o
    ERP. `read_licenciamentos_vencidos` fica disponivel para conferencia
    historica pontual.
    """
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
