"""SQL Server ERP connection helpers."""

import re

from app.config import (
    ERP_IMG_DB,
    ERP_IMG_HOST,
    ERP_IMG_PASS,
    ERP_IMG_USER,
    ERP_PUKET_DB,
    ERP_PUKET_HOST,
    ERP_PUKET_PASS,
    ERP_PUKET_USER,
    LINX_BRANDS,
    LINX_SCHEMA,
)

_IDENT_RE = re.compile(r"^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$")


def _ident(name: str) -> str:
    """Validate a SQL identifier (table/column) before interpolation.

    Identifiers come from server-side config/env, never from request input, but we
    still hard-validate to keep the f-strings injection-proof. Accepts a bare
    identifier or a single schema-qualified form ('dbo.PROP_PRODUTOS'), since Linx
    tables are commonly referenced with the schema prefix.

    Args:
        name: Identifier to validate.

    Returns:
        The identifier unchanged if it is safe.

    Raises:
        ValueError: If the identifier is not [A-Za-z0-9_]+ optionally qualified by
            a single '.' separator.
    """
    if not name or not _IDENT_RE.match(name):
        raise ValueError(f"Unsafe SQL identifier: {name!r}")
    return name


def fetch_ecommerce_stock(brand: str) -> list[dict]:
    """Fetch e-commerce stock from SQL Server ERP (Extrema MG).

    Args:
        brand: Brand name — 'puket' or 'puket_escolares' uses Puket ERP,
               anything else uses Imaginarium ERP.

    Returns:
        List of dicts with at minimum 'PRODUTO'/'produto' and 'ESTOQUE'/'estoque' keys.

    Raises:
        Exception: On connection or query failure.
    """
    import pymssql

    is_puket = brand.lower() in ("puket", "puket_escolares")
    if is_puket:
        host, db_name = ERP_PUKET_HOST, ERP_PUKET_DB
        user, password = ERP_PUKET_USER, ERP_PUKET_PASS
        where = "filial = 'EXTREMA - MG'"
    else:
        host, db_name = ERP_IMG_HOST, ERP_IMG_DB
        user, password = ERP_IMG_USER, ERP_IMG_PASS
        where = "filial LIKE '%IMAGINARIUM EXTREMA MG%'"

    with pymssql.connect(host, user, password, db_name, timeout=15, login_timeout=10) as conn:
        cursor = conn.cursor(as_dict=True)
        # WHERE clause is built from a safe predefined constant — no user input
        cursor.execute(f"SELECT * FROM estoque_produtos WHERE {where}")  # noqa: S608
        return cursor.fetchall()


# ---------------------------------------------------------------------------
# Linx product-property writes (PROP_PRODUTOS / PROPRIEDADE)
# ---------------------------------------------------------------------------


def _brand_linx(brand: str) -> dict[str, str]:
    """Resolve the Linx connection + property-code config for a brand.

    Args:
        brand: Brand name (case-insensitive). 'puket escolares' must match before 'puket'.

    Returns:
        The LINX_BRANDS entry for the brand.

    Raises:
        ValueError: If the brand is not mapped to a Linx database.
    """
    key = (brand or "").lower().strip()
    if key in LINX_BRANDS:
        return LINX_BRANDS[key]
    # tolerate substrings ('puket escolares' before 'puket' so the longer key wins)
    for cfg_key in sorted(LINX_BRANDS, key=len, reverse=True):
        if cfg_key in key or key in cfg_key:
            return LINX_BRANDS[cfg_key]
    raise ValueError(f"Brand '{brand}' is not mapped to a Linx database")


def _connect(cfg: dict[str, str]):
    """Open a pymssql connection to a brand's Linx database.

    Takes the whole brand config because the credentials are per-brand: Puket (db01)
    and Imaginarium (db02) are separate instances with separate logins.

    Args:
        cfg: A LINX_BRANDS entry (host/db/user/password).

    Returns:
        An open pymssql connection (caller is responsible for closing).
    """
    import pymssql

    return pymssql.connect(
        cfg["host"], cfg["user"], cfg["password"], cfg["db"], timeout=15, login_timeout=10
    )


def fetch_barcode_map(brand: str, codes: list[str] | None = None) -> dict[str, str]:
    """Mapeia codigo de barras (EAN) -> codigo de produto no Linx.

    O WMS Biguacu identifica a maior parte dos itens pelo EAN, nao pelo codigo de
    produto: dos 35.342 registros de estoque, 30.787 vem com EAN de 13 digitos e
    so 3.760 com o codigo PIxxxxY da Imaginarium (medido em 2026-08-07). Como
    `cert_products.sku` guarda o codigo de produto, o join por SKU cru so pegava a
    Imaginarium — Puket ficava com 2 de 223 itens com estoque de CD e Puket
    Escolares com 0 de 162. Este mapa e o que fecha essa lacuna.

    A aba "Encerramentos" da planilha tambem traz EAN na coluna de SKU em algumas
    linhas, e usa o mesmo mapa para normalizar.

    Args:
        brand: marca (escolhe o banco/credencial do Linx).
        codes: quando informado, resolve apenas esses codigos (consulta pontual);
            quando None, devolve o mapa inteiro de codigos ativos.

    Returns:
        Dict {codigo_barra -> produto}, ambos ja sem padding. Vazio quando
        `codes` e uma lista vazia.

    Raises:
        Exception: em falha de conexao/consulta (o caller decide se degrada).
    """
    cfg = _brand_linx(brand)
    sql = (
        "SELECT LTRIM(RTRIM(CODIGO_BARRA)), LTRIM(RTRIM(PRODUTO)) "
        "FROM PRODUTOS_BARRA WHERE INATIVO = 0"
    )
    params: tuple = ()
    if codes is not None:
        wanted = sorted({c.strip() for c in codes if c and c.strip()})
        if not wanted:
            return {}
        # Lista vem de dados internos (planilha/WMS), mas ainda assim vai como
        # parametro — nunca interpolada.
        sql += " AND LTRIM(RTRIM(CODIGO_BARRA)) IN ({})".format(",".join(["%s"] * len(wanted)))
        params = tuple(wanted)

    with _connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        return {
            str(barra).strip(): str(produto).strip()
            for barra, produto in cur.fetchall()
            if barra is not None and produto is not None and str(produto).strip()
        }


def fetch_produto_propriedades(
    brand: str, prop_codes: list[str], produtos: list[str]
) -> dict[str, dict[str, str]]:
    """Le, em lote, o valor de propriedades de produto no Linx (PROP_PRODUTOS).

    E a fonte de verdade da "trava de faturamento": a data gravada em VALIDADE DO
    CERTIFICADO (00224 Puket / 00106 Imaginarium) e VENCIMENTO DO LICENCIAMENTO
    (00225 / 00107) e o que efetivamente impede o item de ser faturado.

    O portal NAO serve para isso. `cert_certificates` so registra certificado
    cadastrado pelo formulario do portal, e em 2026-08-07 a tabela estava vazia
    enquanto o Linx tinha trava para 489 dos 658 produtos do painel — as travas
    chegaram la por outros caminhos, entre eles `sync_prazo_venda_to_linx`, que
    grava direto e nao deixa registro no portal.

    Args:
        brand: marca (escolhe o banco/credencial).
        prop_codes: codigos de PROPRIEDADE a buscar (ex.: ['00224', '00225']).
        produtos: codigos de produto a consultar.

    Returns:
        Dict {produto: {prop_code: valor}}, apenas com valor nao vazio. Produto
        ausente do dict = sem trava gravada.

    Raises:
        Exception: em falha de conexao/consulta (o caller decide se degrada).
    """
    if not prop_codes or not produtos:
        return {}

    cfg = _brand_linx(brand)
    table = _ident(LINX_SCHEMA["prop_table"])
    col_prod = _ident(LINX_SCHEMA["prop_col_produto"])
    col_prop = _ident(LINX_SCHEMA["prop_col_propriedade"])
    col_val = _ident(LINX_SCHEMA["prop_col_valor"])

    alvo = sorted({p.strip() for p in produtos if p and p.strip()})
    out: dict[str, dict[str, str]] = {}

    with _connect(cfg) as conn:
        cur = conn.cursor()
        # SQL Server tem teto de 2100 parametros por comando; lotes de 400
        # deixam margem larga mesmo com varias propriedades na mesma consulta.
        for i in range(0, len(alvo), 400):
            lote = alvo[i : i + 400]
            ph_prod = ",".join(["%s"] * len(lote))
            ph_prop = ",".join(["%s"] * len(prop_codes))
            cur.execute(
                f"SELECT LTRIM(RTRIM({col_prod})), {col_prop}, {col_val} "  # noqa: S608
                f"FROM {table} "
                f"WHERE {col_prop} IN ({ph_prop}) AND LTRIM(RTRIM({col_prod})) IN ({ph_prod})",
                (*prop_codes, *lote),
            )
            for produto, prop, valor in cur.fetchall():
                texto = "" if valor is None else str(valor).strip()
                if not texto:
                    continue
                out.setdefault(str(produto).strip(), {})[str(prop).strip()] = texto

    return out


def resolve_produto_codigo(brand: str, sku: str) -> str | None:
    """Resolve a portal SKU to the Linx base product code used by PROP_PRODUTOS.

    The panel SKU is often produto+cor+tamanho (grade level), while certification
    properties live at the base-product level. When LINX_SKU_IS_PRODUTO is true the
    SKU is already the product code, but it is still checked against the product
    table before being handed to the upsert. Otherwise we look the SKU up in the
    product table via the configured columns.

    The existence check is not redundant. Only Puket has a foreign key from
    PROP_PRODUTOS to PRODUTOS (XFKP2_PROP_PRODUTOS); Imaginarium has none, so an
    unknown code would silently become an orphan row in the ERP. And the portal
    does carry SKUs that are not product codes — 7 of Puket's 358 are EANs or codes
    from the other brand's catalogue (2026-07-16). Checking turns those into the
    caller's plain "SKU nao encontrado no Linx" instead of an FK violation on one
    brand and corruption on the other.

    Args:
        brand: Brand name used to pick the Linx database.
        sku: Portal SKU.

    Returns:
        The base product code, or None if it cannot be resolved.

    Raises:
        Exception: On connection/query failure.
    """
    if LINX_SCHEMA.get("sku_is_produto", "false").lower() == "true":
        cfg = _brand_linx(brand)
        table = _ident(LINX_SCHEMA["produto_table"])
        codigo_col = _ident(LINX_SCHEMA["produto_col_codigo"])
        with _connect(cfg) as conn:
            cur = conn.cursor()
            cur.execute(
                f"SELECT TOP 1 {codigo_col} FROM {table} "  # noqa: S608
                f"WHERE LTRIM(RTRIM({codigo_col})) = %s",
                (sku.strip(),),
            )
            row = cur.fetchone()
            return str(row[0]).strip() if row and row[0] is not None else None

    sku_col = LINX_SCHEMA.get("produto_col_sku", "")
    if not sku_col:
        # Fail-closed: without a configured SKU->produto column we must NOT fall back
        # to the raw SKU, or the upsert would INSERT a PROP_PRODUTOS row keyed by the
        # grade-level SKU (produto+cor+tamanho) and pollute production. Refuse instead.
        raise ValueError(
            "Resolucao SKU->produto nao configurada: defina LINX_PRODUTO_COL_SKU "
            "(ou LINX_SKU_IS_PRODUTO=true se o SKU ja for o codigo do produto)."
        )

    cfg = _brand_linx(brand)
    table = _ident(LINX_SCHEMA["produto_table"])
    codigo_col = _ident(LINX_SCHEMA["produto_col_codigo"])
    sku_col = _ident(sku_col)

    with _connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT TOP 1 {codigo_col} FROM {table} WHERE {sku_col} = %s",  # noqa: S608
            (sku,),
        )
        row = cur.fetchone()
        return str(row[0]).strip() if row and row[0] is not None else None


def read_produto_propriedade(brand: str, produto_codigo: str, prop_code: str) -> str | None:
    """Le o valor atual de uma propriedade do produto no Linx.

    Existe para o dry-run do sync poder classificar o que aconteceria sem abrir
    transacao de escrita.

    Args:
        brand: marca (escolhe o banco/credencial).
        produto_codigo: codigo do produto ja resolvido.
        prop_code: codigo da PROPRIEDADE (ex.: '00224').

    Returns:
        O valor (sem padding), ou None quando a propriedade nao existe para o produto.
    """
    cfg = _brand_linx(brand)
    table = _ident(LINX_SCHEMA["prop_table"])
    col_prod = _ident(LINX_SCHEMA["prop_col_produto"])
    col_prop = _ident(LINX_SCHEMA["prop_col_propriedade"])
    col_val = _ident(LINX_SCHEMA["prop_col_valor"])

    with _connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT TOP 1 {col_val} FROM {table} "  # noqa: S608
            f"WHERE {col_prod} = %s AND {col_prop} = %s",
            (produto_codigo, prop_code),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return "" if row[0] is None else str(row[0]).strip()


def upsert_produto_propriedade(
    brand: str, produto_codigo: str, prop_code: str, valor: str
) -> str:
    """Insert-or-update a single product property value in Linx (PROP_PRODUTOS).

    Reads the current value under lock, then INSERTs when the property is absent,
    UPDATEs when the certification system carries a different value, and does
    nothing when it already matches. Table/column names come from validated config;
    the product code, property code and value are always bound parameters.

    The INSERT must supply ITEM_PROPRIEDADE: it is the third column of the PK and is
    smallint NOT NULL with no default in both databases, so omitting it fails every
    time the product doesn't have the property yet (the exact path a first-time
    certificate registration takes). It is the property's multi-value index; the four
    certification properties are single-valued and use item=1 across every existing
    row, which is why matching on (produto, propriedade) alone is unambiguous here.

    Skipping the no-op write is not just tidiness: PROP_PRODUTOS carries an active
    trigger on Puket (LXU_PROP_PRODUTOS), so rewriting an identical value would fire
    Linx's replication for nothing.

    Args:
        brand: Brand name used to pick the Linx database and credentials.
        produto_codigo: Base product code (already resolved).
        prop_code: PROPRIEDADE code (e.g. '00224').
        valor: Value to store (e.g. the formatted date string).

    Returns:
        'inserted', 'updated' or 'unchanged'.

    Raises:
        Exception: On connection/query failure (transaction is rolled back).
    """
    cfg = _brand_linx(brand)
    table = _ident(LINX_SCHEMA["prop_table"])
    col_prod = _ident(LINX_SCHEMA["prop_col_produto"])
    col_prop = _ident(LINX_SCHEMA["prop_col_propriedade"])
    col_val = _ident(LINX_SCHEMA["prop_col_valor"])
    col_item = _ident(LINX_SCHEMA["prop_col_item"])
    item_value = int(LINX_SCHEMA["prop_item_value"])

    conn = _connect(cfg)
    try:
        cur = conn.cursor()
        # UPDLOCK+HOLDLOCK serialize the "row absent" case so two concurrent upserts
        # for the same (produto, propriedade) can't both fall through to INSERT.
        cur.execute(
            f"SELECT {col_val} FROM {table} WITH (UPDLOCK, HOLDLOCK) "  # noqa: S608
            f"WHERE {col_prod} = %s AND {col_prop} = %s",
            (produto_codigo, prop_code),
        )
        row = cur.fetchone()

        if row is None:
            cur.execute(
                f"INSERT INTO {table} ({col_prod}, {col_prop}, {col_item}, {col_val}) "  # noqa: S608
                f"VALUES (%s, %s, %s, %s)",
                (produto_codigo, prop_code, item_value, valor),
            )
            conn.commit()
            return "inserted"

        # VALOR_PROPRIEDADE is a padded text column — compare trimmed, or every
        # write would look like a change.
        current = "" if row[0] is None else str(row[0]).strip()
        if current == valor.strip():
            conn.commit()  # nothing to write; just release the lock
            return "unchanged"

        cur.execute(
            f"UPDATE {table} SET {col_val} = %s "  # noqa: S608
            f"WHERE {col_prod} = %s AND {col_prop} = %s",
            (valor, produto_codigo, prop_code),
        )
        conn.commit()
        return "updated"
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
