"""SQL Server ERP connection helpers."""

from app.config import (
    ERP_IMG_DB,
    ERP_IMG_HOST,
    ERP_MSSQL_PASS,
    ERP_MSSQL_USER,
    ERP_PUKET_DB,
    ERP_PUKET_HOST,
)


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
