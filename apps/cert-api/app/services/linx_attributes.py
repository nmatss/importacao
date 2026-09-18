"""Leitura EM LOTE de atributos e propriedades do Linx para o painel (somente leitura).

Ate 2026-09-11 o status de licenciamento do painel saia da aba "Licenciamentos
Vencidos" da planilha. Os cabecalhos reais dessa aba (A=Marca B=Produto C=Desc
Produto D=Griffe E=Contrato Licenciamento F=Situacao Contrato) nao tem NENHUMA
coluna de data, entao `license_deadline` era sempre None e a coluna
"Licen. - Prazo" nunca exibia data alguma. O dado vivo esta no Linx:

- propriedade 00107 (Imaginarium) / 00225 (Puket) = VENCIMENTO DO LICENCIAMENTO;
- propriedade 00106 / 00224 = a propriedade que na pratica trava o faturamento;
- `PRODUTO_CORES.FIM_VENDAS` = a trava efetivamente aplicada pelo ERP;
- a grife/licenca fica em `PRODUTOS.GRIFFE` (Puket) e `PRODUTOS.IMG_LICENCIAMENTO`
  (Imaginarium, onde GRIFFE guarda a marca da casa).

Decisao D11: este modulo SO LE. Ele grava apenas nas colunas `linx_*`/`grife` de
`cert_products` (contrato entregue pela fundacao), sem tocar em nada que venha
da planilha. Linx fora do ar nao vira "sem licenca": a marca inteira e pulada,
`linx_synced_at` NAO e atualizado e o erro volta no resultado do sync.
"""

from datetime import date, datetime

from app.db.postgres import db
from app.db.sqlserver import _brand_linx, _connect, _ident, fetch_produto_propriedades
from app.utils.logging import log

# Lote do IN (...) do SQL Server: o teto e 2100 parametros por comando e a
# mesma margem larga usada por `fetch_produto_propriedades`.
_BATCH = 400

# Coluna de grife por marca. Na Puket `GRIFFE` guarda o licenciador (MINIONS,
# HARRY POTTER, MARVEL...); na Imaginarium ela guarda a marca da casa
# (IMAGINARIUM/LUDI/MIND) e o licenciador mora em `IMG_LICENCIAMENTO`.
_GRIFE_COLUMN_BY_BRAND: dict[str, str] = {
    "imaginarium": "IMG_LICENCIAMENTO",
    "puket": "GRIFFE",
    "puket escolares": "GRIFFE",
}
_DEFAULT_GRIFE_COLUMN = "GRIFFE"

_PRODUTO_CORES_TABLE = "PRODUTO_CORES"
_PRODUTO_CORES_FIM_VENDAS = "FIM_VENDAS"


def grife_column_for(brand: str) -> str:
    """Coluna de `PRODUTOS` que guarda a grife/licenca da marca."""
    key = " ".join((brand or "").lower().replace("_", " ").split())
    return _GRIFE_COLUMN_BY_BRAND.get(key, _DEFAULT_GRIFE_COLUMN)


def parse_linx_date(value: object, *, strict: bool = False) -> date | None:
    """Converte um valor de data do Linx em `date`, tratando a sentinela.

    O ERP representa "sem data" com 01/01/1900 e o default da propriedade e
    exatamente esse valor (2.464 de 4.795 linhas na 00225 em 11/09/2026).
    Devolver a sentinela como data real faria um produto sem licenciamento
    aparecer como licenciamento VENCIDO em 1900. Decisao D11: ano < 2000 e
    ausencia.

    Returns:
        A data, ou None para vazio, sentinela ou texto nao reconhecido.
        Com strict=True, texto nao reconhecido gera ValueError para preservar
        o snapshot anterior em vez de transformar erro de origem em ausencia.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value.date()
    elif isinstance(value, date):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        parsed = None
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%Y-%m-%d %H:%M:%S"):
            try:
                parsed = datetime.strptime(text[:19] if " " in text else text, fmt).date()
                break
            except ValueError:
                continue
        if parsed is None:
            if strict:
                raise ValueError("Data de propriedade Linx invalida")
            return None
    return None if parsed.year < 2000 else parsed


def fetch_produto_atributos(brand: str, produtos: list[str]) -> dict[str, dict]:
    """Le, em lote, grife e FIM_VENDAS dos produtos de uma marca no Linx.

    Args:
        brand: marca do portal (escolhe banco, credencial e coluna de grife).
        produtos: codigos de produto ja resolvidos.

    Returns:
        Dict `{produto: {'grife': str|None, 'fim_vendas': date|None}}`. Produto
        encontrado sem atributos tem dict vazio; produto nao encontrado nao tem
        chave. Assim ausencia no ERP nao pode apagar um snapshot valido.

    Raises:
        Exception: falha de conexao/consulta (o chamador decide se degrada).
    """
    if not produtos:
        return {}

    cfg = _brand_linx(brand)
    produto_table = _ident("PRODUTOS")
    produto_col = _ident("PRODUTO")
    grife_col = _ident(grife_column_for(brand))
    cores_table = _ident(_PRODUTO_CORES_TABLE)
    fim_vendas_col = _ident(_PRODUTO_CORES_FIM_VENDAS)

    alvo = sorted({p.strip() for p in produtos if p and p.strip()})
    out: dict[str, dict] = {}

    with _connect(cfg) as conn:
        cur = conn.cursor()
        for i in range(0, len(alvo), _BATCH):
            lote = alvo[i : i + _BATCH]
            placeholders = ",".join(["%s"] * len(lote))

            cur.execute(
                f"SELECT LTRIM(RTRIM({produto_col})), {grife_col} "  # noqa: S608
                f"FROM {produto_table} "
                f"WHERE LTRIM(RTRIM({produto_col})) IN ({placeholders})",
                tuple(lote),
            )
            for produto, grife in cur.fetchall():
                entry = out.setdefault(str(produto).strip(), {})
                texto = "" if grife is None else str(grife).strip()
                if texto:
                    entry["grife"] = texto

            # A trava vive por COR; o que bloqueia o faturamento e a primeira a
            # vencer, entao o produto carrega o MENOR FIM_VENDAS real. MIN()
            # ignora NULL sozinho, mas nao a sentinela 01/01/1900 — por isso a
            # normalizacao acontece em Python, depois do fetch.
            cur.execute(
                f"SELECT LTRIM(RTRIM({produto_col})), {fim_vendas_col} "  # noqa: S608
                f"FROM {cores_table} "
                f"WHERE LTRIM(RTRIM({produto_col})) IN ({placeholders})",
                tuple(lote),
            )
            for produto, fim_vendas in cur.fetchall():
                parsed = parse_linx_date(fim_vendas)
                if parsed is None:
                    continue
                key = str(produto).strip()
                entry = out.get(key)
                if entry is None:
                    continue  # Uma cor orfa nao comprova existencia em PRODUTOS.
                atual = entry.get("fim_vendas")
                if atual is None or parsed < atual:
                    entry["fim_vendas"] = parsed

    return out


_UPDATE_SQL = """
    UPDATE cert_products
    SET grife = %s,
        linx_fim_licenciamento = %s,
        linx_prop_certificacao = %s,
        linx_fim_vendas = %s,
        linx_synced_at = NOW()
    WHERE sku = %s
"""


def _load_skus_by_brand(brand_filter: str | None) -> dict[str, list[str]]:
    """Agrupa os SKUs de `cert_products` por marca (marca vazia fica de fora)."""
    out: dict[str, list[str]] = {}
    with db() as (conn, cur):
        if brand_filter:
            cur.execute(
                "SELECT brand, sku FROM cert_products "
                "WHERE brand <> '' AND LOWER(REPLACE(brand, '_', ' ')) = %s ORDER BY sku",
                [" ".join(brand_filter.lower().replace("_", " ").split())],
            )
        else:
            cur.execute("SELECT brand, sku FROM cert_products WHERE brand <> '' ORDER BY sku")
        for row in cur.fetchall():
            out.setdefault(row["brand"], []).append(row["sku"])
    return out


def sync_linx_attributes(brand_filter: str | None = None) -> dict:
    """Copia grife, licenciamento e trava do Linx para `cert_products`.

    Em producao `LINX_SKU_IS_PRODUTO=true`, ou seja, o SKU do painel JA e o
    codigo do produto — por isso a leitura e feita direto em lote, sem um
    `resolve_produto_codigo` por SKU (674 idas ao SQL Server).

    Returns:
        Dict com `updated`, `brands` (uma entrada por marca com o que foi lido)
        e `errors` (marcas puladas, com o TIPO da excecao; nunca a mensagem, que
        pode carregar host/login).
    """
    result: dict = {"updated": 0, "brands": [], "errors": []}
    skus_por_marca = _load_skus_by_brand(brand_filter)

    for brand, skus in skus_por_marca.items():
        try:
            cfg = _brand_linx(brand)
        except ValueError:
            result["errors"].append({"brand": brand, "error": "marca sem Linx configurado"})
            continue

        prop_cert = cfg["prop_validade_certificado"]
        prop_lic = cfg["prop_vencimento_licenciamento"]
        try:
            props = fetch_produto_propriedades(
                brand, [prop_cert, prop_lic], skus, strict_prop_codes=[prop_lic]
            )
            atributos = fetch_produto_atributos(brand, skus)
            # Validar antes de abrir a transacao de escrita: valor ilegivel nao
            # e equivalente a uma sentinela/vazio confirmado no ERP.
            licencas = {
                sku: parse_linx_date(props.get(sku, {}).get(prop_lic), strict=True)
                for sku in skus if sku in atributos
            }
        except Exception as e:
            # "Linx indisponivel" nao pode virar "sem licenca": a marca inteira
            # fica com os valores anteriores e o linx_synced_at antigo.
            log.warning(f"Linx attribute sync skipped for brand={brand}: {type(e).__name__}")
            result["errors"].append({"brand": brand, "error": type(e).__name__})
            continue

        ausentes = sum(sku not in atributos for sku in skus)
        if ausentes:
            result["errors"].append({
                "brand": brand, "error": "Produtos nao encontrados no Linx; snapshot anterior preservado",
                "count": ausentes,
            })
        updated = 0
        with db() as (conn, cur):
            for sku in skus:
                if sku not in atributos:
                    continue
                valores = props.get(sku, {})
                extra = atributos.get(sku, {})
                cur.execute(
                    _UPDATE_SQL,
                    [
                        extra.get("grife"),
                        licencas[sku],
                        parse_linx_date(valores.get(prop_cert)),
                        extra.get("fim_vendas"),
                        sku,
                    ],
                )
                updated += cur.rowcount or 0

        result["updated"] += updated
        result["brands"].append(
            {
                "brand": brand,
                "skus": len(skus),
                "updated": updated,
                "com_licenciamento": sum(1 for value in licencas.values() if value),
                "com_grife": sum(1 for s in skus if atributos.get(s, {}).get("grife")),
            }
        )

    return result
