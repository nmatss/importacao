"""SQL Server ERP connection helpers."""

import re

from app.config import (
    ERP_IMG_DB,
    ERP_IMG_HOST,
    ERP_MSSQL_PASS,
    ERP_MSSQL_USER,
    ERP_PUKET_DB,
    ERP_PUKET_HOST,
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

    if brand.lower() in ("puket", "puket_escolares"):
        host = ERP_PUKET_HOST
        db_name = ERP_PUKET_DB
        where = "filial = 'EXTREMA - MG'"
    else:
        host = ERP_IMG_HOST
        db_name = ERP_IMG_DB
        where = "filial LIKE '%IMAGINARIUM EXTREMA MG%'"

    with pymssql.connect(host, ERP_MSSQL_USER, ERP_MSSQL_PASS, db_name, timeout=15, login_timeout=10) as conn:
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


def _connect(host: str, db_name: str):
    """Open a pymssql connection to a Linx database.

    Args:
        host: SQL Server host.
        db_name: Database name.

    Returns:
        An open pymssql connection (caller is responsible for closing).
    """
    import pymssql

    return pymssql.connect(
        host, ERP_MSSQL_USER, ERP_MSSQL_PASS, db_name, timeout=15, login_timeout=10
    )


def resolve_produto_codigo(brand: str, sku: str) -> str | None:
    """Resolve a portal SKU to the Linx base product code used by PROP_PRODUTOS.

    The panel SKU is often produto+cor+tamanho (grade level), while certification
    properties live at the base-product level. When LINX_SKU_IS_PRODUTO is true the
    SKU is already the product code and is returned as-is. Otherwise we look the SKU
    up in the product table via the configured columns.

    Args:
        brand: Brand name used to pick the Linx database.
        sku: Portal SKU.

    Returns:
        The base product code, or None if it cannot be resolved.

    Raises:
        Exception: On connection/query failure.
    """
    if LINX_SCHEMA.get("sku_is_produto", "false").lower() == "true":
        return sku

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

    with _connect(cfg["host"], cfg["db"]) as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT TOP 1 {codigo_col} FROM {table} WHERE {sku_col} = %s",  # noqa: S608
            (sku,),
        )
        row = cur.fetchone()
        return str(row[0]).strip() if row and row[0] is not None else None


def upsert_produto_propriedade(
    brand: str, produto_codigo: str, prop_code: str, valor: str
) -> str:
    """Insert-or-update a single product property value in Linx (PROP_PRODUTOS).

    UPDATE first, INSERT only if no row matched — the whole thing runs in one
    transaction. Table/column names come from validated config; the product code,
    property code and value are always bound parameters.

    Args:
        brand: Brand name used to pick the Linx database.
        produto_codigo: Base product code (already resolved).
        prop_code: PROPRIEDADE code (e.g. '00224').
        valor: Value to store (e.g. the formatted date string).

    Returns:
        'updated' or 'inserted'.

    Raises:
        Exception: On connection/query failure (transaction is rolled back).
    """
    cfg = _brand_linx(brand)
    table = _ident(LINX_SCHEMA["prop_table"])
    col_prod = _ident(LINX_SCHEMA["prop_col_produto"])
    col_prop = _ident(LINX_SCHEMA["prop_col_propriedade"])
    col_val = _ident(LINX_SCHEMA["prop_col_valor"])

    conn = _connect(cfg["host"], cfg["db"])
    try:
        cur = conn.cursor()
        # UPDLOCK+HOLDLOCK serialize the "row absent" case so two concurrent upserts
        # for the same (produto, propriedade) can't both fall through to INSERT.
        # SET NOCOUNT ON + an explicit SELECT @@ROWCOUNT make the affected-row count
        # reliable even if PROP_PRODUTOS carries triggers (common in Linx).
        cur.execute(
            f"SET NOCOUNT ON; "  # noqa: S608
            f"UPDATE {table} WITH (UPDLOCK, HOLDLOCK, ROWLOCK) SET {col_val} = %s "
            f"WHERE {col_prod} = %s AND {col_prop} = %s; SELECT @@ROWCOUNT",
            (valor, produto_codigo, prop_code),
        )
        row = cur.fetchone()
        affected = int(row[0]) if row and row[0] is not None else 0
        if affected > 0:
            conn.commit()
            return "updated"
        cur.execute(
            f"INSERT INTO {table} ({col_prod}, {col_prop}, {col_val}) "  # noqa: S608
            f"VALUES (%s, %s, %s)",
            (produto_codigo, prop_code, valor),
        )
        conn.commit()
        return "inserted"
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
