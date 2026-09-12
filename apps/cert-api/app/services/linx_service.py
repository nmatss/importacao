"""Write certificate dates into Linx product properties (PROP_PRODUTOS).

Fail-closed: nothing is written to Linx unless LINX_WRITE_ENABLED is true. While
disabled, certificates are still persisted in the portal (Postgres) and reported
back with linx_status='disabled' so the UI can show them as pending.
"""

import json
from datetime import date, datetime

from app.config import LINX_BRANDS, LINX_SCHEMA, LINX_WRITE_ENABLED, REPORTS_DIR
from app.db.sqlserver import (
    _brand_linx,
    fetch_produto_propriedades,
    read_produto_propriedade,
    resolve_produto_codigo,
    upsert_produto_propriedade,
)
from app.services.derivation import (
    derive_situacao_status,
    derive_trava_venda,
    parse_data_real,
)
from app.utils.logging import log

# "Zerar" uma propriedade no Linx = gravar a sentinela que o proprio ERP usa para
# "campo criado, sem data". Apagar a linha de PROP_PRODUTOS exigiria permissao de
# DELETE que o sistema nao tem e nao pede. Nada disso e executado por este codigo:
# o valor so aparece como PROPOSTA no relatorio do dry-run.
SENTINELA_LINX = "01/01/1900"

# Acoes do dry-run que NUNCA gravam, nem com dry_run=False. Cada uma depende de
# decisao fiscal (reuniao 11/09) e nao pode sair como efeito colateral de um sync.
ACAO_ATIVO_LIMPAR = "limpar: ativo"
ACAO_ATIVO_SEM_DATA = "bloqueado: certificado ativo"
ACAO_DUPLA = "dupla certificacao"
ACAO_SITUACAO_DESCONHECIDA = "bloqueado: situacao desconhecida"


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


def _parse_linx_date(value: object) -> tuple[str | None, str]:
    """Convert a Linx text property into an ISO date and a lookup state.

    A decisao de "isto e data real?" e do parser UNICO
    ``derivation.parse_data_real``: vazio e sentinela (qualquer ano < 2000, o que
    cobre o ``01/01/1900`` do ERP) viram ``empty``. Devolver a sentinela como
    data real deixaria o input de data do formulario preenchido com um
    certificado vencido em 1900.

    Antes o corte aqui era ``year <= 1900`` e no relatorio ``year < 2000``: o
    mesmo valor contava como trava num lugar e nao contava no outro.

    Returns:
        Tuple ``(iso_date, state)`` where state is ``found``, ``empty`` or
        ``invalid``.
    """
    if value is None:
        return None, "empty"
    parsed = parse_data_real(value)
    if parsed is not None:
        return parsed.isoformat(), "found"
    if isinstance(value, date | datetime):
        return None, "empty"  # objeto de data anterior a 2000 = sentinela
    texto = str(value).strip()
    if not texto:
        return None, "empty"
    # Sem data real: sentinela (texto COM forma de data) ou texto livre.
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
        try:
            datetime.strptime(texto, fmt)
            return None, "empty"
        except ValueError:
            continue
    return None, "invalid"


def read_certificate_from_linx(brand: str, sku: str) -> dict:
    """Read the two certificate properties currently stored in Linx.

    This is deliberately read-only and uses the same SKU resolution and brand
    mapping as the write path, preventing the registration form from showing a
    value from one product and writing to another.

    Args:
        brand: Portal brand/slug (Puket Escolares maps to the Puket database).
        sku: Portal product code.

    Returns:
        Lookup payload with the resolved Linx product, ISO dates suitable for
        HTML date inputs and per-property diagnostic metadata.

    Raises:
        ValueError: Unsupported brand or blank SKU.
        LookupError: SKU does not exist in the selected Linx database.
        Exception: Connection/query failure.
    """
    clean_sku = sku.strip()
    if not clean_sku:
        raise ValueError("SKU obrigatorio")

    cfg = _brand_linx(brand)
    produto = resolve_produto_codigo(brand, clean_sku)
    if not produto:
        raise LookupError("SKU nao encontrado no Linx")

    fields = (
        ("validade_certificado", cfg["prop_validade_certificado"]),
        ("vencimento_licenciamento", cfg["prop_vencimento_licenciamento"]),
    )
    props = fetch_produto_propriedades(brand, [code for _, code in fields], [produto])
    values = props.get(produto, {})
    details: dict[str, dict[str, str | None]] = {}
    result: dict = {
        "sku": clean_sku,
        "brand": brand.strip(),
        "produto_codigo": produto,
    }
    for field, code in fields:
        raw_value = values.get(code)
        iso_date, state = _parse_linx_date(raw_value)
        result[field] = iso_date
        details[field] = {
            "property_code": code,
            "raw_value": raw_value,
            "state": state,
        }
    result["properties"] = details
    result["status"] = "found" if any(result[field] for field, _ in fields) else "empty"
    return result


def write_certificate_to_linx(
    brand: str,
    sku: str,
    validade_certificado: str | date | None,
    vencimento_licenciamento: str | date | None,
    fim_venda: str | date | None = None,
    situacao: str | None = None,
) -> dict:
    """Upsert the certification properties for a product into Linx.

    Decisao D11 (reuniao 11/09): a propriedade de certificacao (00106/00224) e
    uma TRAVA DE FATURAMENTO, entao so recebe FIM DE VENDA — nunca a validade do
    certificado. Era essa confusao que travava Vitrola e Karaoke, ativos, com a
    propria data de validade (63 SKUs ativos com data na propriedade em
    11/09/2026, 38 deles exatamente iguais a validade).

    Certificado ATIVO nao tem fim de venda ("enquanto ele estiver ativo eu posso
    vender"): com `situacao` dizendo ATIVO, a gravacao da certificacao e RECUSADA
    mesmo que venha uma data.

    Args:
        brand: Brand name (selects Puket vs Imaginarium Linx + property codes).
        sku: Portal SKU; resolved to the base product code internally.
        validade_certificado: validade do certificado. Guardada no portal e
            exibida; NUNCA escrita no Linx (mantida na assinatura porque e o
            campo do formulario de cadastro).
        vencimento_licenciamento: Date for the 'VENCIMENTO DO LICENCIAMENTO' property.
        fim_venda: fim de venda (trava) do certificado encerrado — o unico valor
            que pode ir para a propriedade de certificacao.
        situacao: situacao do certificado ('Ativo' / 'Encerrado'), quando conhecida.

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
        result["error"] = "Falha ao resolver o SKU no Linx"
        sku_log = sku.replace("\r", " ").replace("\n", " ")
        brand_log = brand.replace("\r", " ").replace("\n", " ")
        log.error(
            f"Linx SKU resolution failed for sku={sku_log} brand={brand_log} "
            f"type={type(e).__name__}"
        )
        return result

    if not produto:
        result["status"] = "error"
        result["error"] = f"SKU '{sku}' nao encontrado no Linx"
        return result

    result["produto_codigo"] = produto

    # A validade do certificado NAO e escrita no Linx em nenhuma hipotese: ela
    # serve para decidir manutencao/encerramento, e nao trava faturamento.
    certificado_ativo = derive_situacao_status(situacao) == "ATIVO"

    targets = [
        ("fim_venda", cfg["prop_validade_certificado"], None if certificado_ativo else fim_venda),
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
                motivo = (
                    ACAO_ATIVO_SEM_DATA
                    if field == "fim_venda" and certificado_ativo
                    else "skipped (sem valor)"
                )
                result["details"].append(
                    {"field": field, "prop": prop_code, "action": motivo}
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
        result["error"] = "Falha ao gravar propriedade no Linx"
        sku_log = sku.replace("\r", " ").replace("\n", " ")
        brand_log = brand.replace("\r", " ").replace("\n", " ")
        log.error(
            f"Linx write failed for sku={sku_log} brand={brand_log} "
            f"type={type(e).__name__}"
        )
        return result

    result["status"] = "applied"
    return result


def _parse_br_date(value: str) -> date | None:
    """Le uma data de trava; None para texto ('venda ate fim do lote') e sentinela.

    Usa o parser unico: um `01/01/1900` no valor ATUAL do Linx significa "campo
    sem data", e tratar isso como data faria a comparacao de janela de venda
    (`encurta janela`) rodar contra 1900.
    """
    return parse_data_real(value)


def _salvar_relatorio_sync(resultado: dict) -> str | None:
    """Grava o antes/depois por SKU em REPORTS_DIR — SEMPRE, dry-run inclusive.

    O Linx nao versiona PROP_PRODUTOS: sem este arquivo, sobrescrever a validade
    de centenas de produtos e irreversivel. E o dry-run precisa do arquivo tanto
    quanto o apply — e ele que o time fiscal confere antes de autorizar a carga
    (antes so o `--apply` salvava, e o unico registro do dry-run era o stdout).
    """
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    sufixo = "dry-run" if resultado.get("dry_run") else "apply"
    path = REPORTS_DIR / f"sync-prazo-linx-{sufixo}-{stamp}.json"
    try:
        path.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        log.warning(f"Nao foi possivel salvar o relatorio do sync: {e}")
        return None
    return str(path)


def sync_prazo_venda_to_linx(
    dry_run: bool = True, brand_filter: str | None = None, salvar_relatorio: bool = True
) -> dict:
    """Reconcilia o FIM DE VENDA da planilha com a propriedade do Linx.

    O time fiscal mantem o fim de venda na aba "Encerramentos"; o Linx guarda o
    mesmo dado na propriedade de certificacao (00224 Puket / 00106 Imaginarium),
    que e a trava de faturamento.

    `dry_run=True` (padrao) NAO escreve nada: apenas classifica o que aconteceria
    e grava o relatorio antes/depois. Escrever no ERP de producao exige
    `dry_run=False` explicito.

    Grupos que NUNCA sao gravados, nem com `dry_run=False`, porque dependem de
    decisao fiscal e nao podem sair como efeito colateral de um sync:
    - certificado ATIVO (coluna U): nao pode ter data de certificacao. Quando o
      Linx ja tem uma, a proposta e `limpar: ativo` (valor `01/01/1900`), que
      exige autorizacao explicita de escrita no ERP.
    - `dupla certificacao`: o encerramento e de um certificado DIFERENTE do
      vigente (PI6552Y) — o prazo do certificado velho nao vale para o novo.
    - `encurta_janela`: o prazo da planilha e anterior ao que ja esta no Linx,
      entao gravar TIRA dias de venda do produto.
    - `ambiguos`: o mesmo SKU aparece em encerramentos com prazos diferentes.

    Sem o mapa de situacao (planilha fora do ar) NADA e gravado: decidir trava
    sem saber se o certificado esta vivo e exatamente o defeito que a reuniao
    apontou.

    Args:
        dry_run: quando True, so simula.
        brand_filter: limita a uma marca (ex.: 'puket'); None processa todas.
        salvar_relatorio: grava o JSON antes/depois em REPORTS_DIR.

    Returns:
        Dict com `dry_run`, contadores por acao, `totais_por_marca`, a lista
        `items` (uma entrada por SKU, com situacao, certificado, valores atuais,
        valor proposto, trava esperada e acao), `encurta_janela`, `ambiguos` e
        `report_path`.
    """
    from app.services.erp_service import read_encerramentos_prazos, read_situacao_por_sku

    result: dict = {
        "dry_run": dry_run,
        "counts": {},
        "totais_por_marca": {},
        "items": [],
        "encurta_janela": [],
        "ambiguos": [],
        "report_path": None,
        "error": None,
    }

    if not dry_run and not LINX_WRITE_ENABLED:
        result["error"] = "Escrita no Linx desabilitada (LINX_WRITE_ENABLED=false)"
        return result

    linhas = read_encerramentos_prazos()
    if not linhas:
        result["error"] = "Nenhum prazo lido da aba 'Encerramentos'"
        return result

    situacoes = read_situacao_por_sku()
    if not situacoes and not dry_run:
        result["error"] = (
            "Situacao (coluna U) indisponivel: sem ela nao da para saber se o "
            "certificado esta ativo, e certificado ativo nao pode receber data."
        )
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
        vigente = situacoes.get(sku, {})
        item = {
            "sku": sku,
            "brand": brand,
            "prazo": prazo_raw,
            "situacao": vigente.get("situacao", ""),
            "certificado_encerramento": linha.get("certificado") or "",
            "certificado_vigente": vigente.get("numero_certificado", ""),
            "validade_certificado": vigente.get("validade_certificado"),
            "valor_atual": None,
            "valor_atual_licenciamento": None,
            "valor_proposto": None,
            "trava_esperada": None,
            "acao": None,
        }

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
        try:
            atual_lic = read_produto_propriedade(
                brand, produto, cfg["prop_vencimento_licenciamento"]
            )
        except Exception as e:  # leitura extra nao pode derrubar a classificacao
            log.warning(f"Nao foi possivel ler o licenciamento de {sku}: {type(e).__name__}")
            atual_lic = None
        item["valor_atual_licenciamento"] = atual_lic

        situacao_status = derive_situacao_status(vigente.get("situacao"))
        trava_esperada, origem = derive_trava_venda(
            prazo_date, atual_lic, situacao_status or "ENCERRADO"
        )
        item["trava_esperada"] = trava_esperada.isoformat() if trava_esperada else None
        item["trava_origem"] = origem

        if situacao_status == "ATIVO":
            # Certificado vivo nao tem trava de certificacao. Nada e gravado:
            # quando ha data real no Linx, o relatorio PROPOE a limpeza.
            cert_enc = _so_alfanumerico(linha.get("certificado"))
            cert_vig = _so_alfanumerico(vigente.get("numero_certificado"))
            if cert_enc and cert_vig and cert_enc != cert_vig:
                registrar(item, ACAO_DUPLA)
                continue
            if parse_data_real(atual) is not None:
                item["valor_proposto"] = SENTINELA_LINX
                registrar(item, ACAO_ATIVO_LIMPAR)
                continue
            registrar(item, ACAO_ATIVO_SEM_DATA)
            continue

        if situacao_status is None and not vigente:
            # SKU que so existe em "Encerramentos": e encerrado por definicao,
            # segue o fluxo normal. Sem linha de produto NENHUMA nao ha o que
            # conferir; o caso bloqueado e outro: linha existe com U ilegivel.
            pass
        elif situacao_status is None:
            registrar(item, ACAO_SITUACAO_DESCONHECIDA)
            continue

        item["valor_proposto"] = valor

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
    por_marca: dict[str, dict[str, int]] = {}
    for it in result["items"]:
        marca = por_marca.setdefault(it["brand"], {})
        marca[it["acao"]] = marca.get(it["acao"], 0) + 1
    result["totais_por_marca"] = por_marca
    result["diff"] = [
        it for it in result["items"] if it.get("valor_proposto") and it["valor_proposto"] != (it["valor_atual"] or "").strip()
    ]
    if salvar_relatorio:
        result["report_path"] = _salvar_relatorio_sync(result)
    return result


def _so_alfanumerico(valor: object) -> str:
    """Normaliza o numero do certificado para comparar entre abas."""
    return "".join(ch for ch in str(valor or "").upper() if ch.isalnum())


# Re-export so callers don't reach into config directly.
SUPPORTED_BRANDS = list(LINX_BRANDS.keys())
