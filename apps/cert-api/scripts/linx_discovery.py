"""CLI read-only de descoberta do schema Linx (versão executável do sql/linx_discovery.sql).

Roda os blocos [1]-[6] da descoberta direto no SQL Server da marca, usando as
mesmas credenciais ERP_* do cert-api — sem precisar de SSMS. SOMENTE LEITURA.

Uso (no servidor, onde o .env tem ERP_MSSQL_USER/PASS):

    docker exec importacao-cert-api python scripts/linx_discovery.py puket
    docker exec importacao-cert-api python scripts/linx_discovery.py imaginarium
    # opcional: passe um SKU real para o bloco [7]
    docker exec importacao-cert-api python scripts/linx_discovery.py puket 12345-001-P

Com o resultado, preencha LINX_PROP_COL_*, LINX_PRODUTO_COL_SKU (ou
LINX_SKU_IS_PRODUTO=true) e só então LINX_WRITE_ENABLED=true.
Doc: docs/CERT-LINX-WRITE.md (seção go-live).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import (  # noqa: E402
    ERP_IMG_DB,
    ERP_IMG_HOST,
    ERP_MSSQL_PASS,
    ERP_MSSQL_USER,
    ERP_PUKET_DB,
    ERP_PUKET_HOST,
)

QUERIES: list[tuple[str, str]] = [
    (
        "[1] Colunas de PROP_PRODUTOS",
        "SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS LEN, IS_NULLABLE "
        "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PROP_PRODUTOS' ORDER BY ORDINAL_POSITION",
    ),
    (
        "[2] Colunas de PROPRIEDADE",
        "SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS LEN, IS_NULLABLE "
        "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PROPRIEDADE' ORDER BY ORDINAL_POSITION",
    ),
    (
        "[3] Chaves primarias",
        "SELECT t.TABLE_NAME, kcu.COLUMN_NAME, kcu.ORDINAL_POSITION "
        "FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t "
        "JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON t.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME "
        "WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY' AND t.TABLE_NAME IN ('PROP_PRODUTOS','PROPRIEDADE') "
        "ORDER BY t.TABLE_NAME, kcu.ORDINAL_POSITION",
    ),
    ("[4] Catalogo PROPRIEDADE (top 200)", "SELECT TOP 200 * FROM PROPRIEDADE ORDER BY 1"),
    ("[5] Amostra PROP_PRODUTOS (top 30)", "SELECT TOP 30 * FROM PROP_PRODUTOS ORDER BY 1"),
    (
        "[6] Colunas candidatas a SKU/produto",
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE (COLUMN_NAME LIKE '%PRODUTO%' OR COLUMN_NAME LIKE '%SKU%' OR COLUMN_NAME LIKE '%REFERENC%' "
        "OR COLUMN_NAME LIKE '%COR%' OR COLUMN_NAME LIKE '%TAMANHO%' OR COLUMN_NAME LIKE '%GRADE%' "
        "OR COLUMN_NAME LIKE '%BARRA%' OR COLUMN_NAME LIKE '%EAN%') "
        "AND TABLE_NAME LIKE '%PRODUT%' ORDER BY TABLE_NAME, ORDINAL_POSITION",
    ),
]


def _print_rows(rows: list[dict]) -> None:
    if not rows:
        print("  (vazio)")
        return
    cols = list(rows[0].keys())
    print("  " + " | ".join(str(c) for c in cols))
    for r in rows:
        print("  " + " | ".join("" if r[c] is None else str(r[c]).strip() for c in cols))


def main() -> int:
    brand = (sys.argv[1] if len(sys.argv) > 1 else "puket").lower()
    sku = sys.argv[2] if len(sys.argv) > 2 else None

    if brand.startswith("puket"):
        host, db_name = ERP_PUKET_HOST, ERP_PUKET_DB
    else:
        host, db_name = ERP_IMG_HOST, ERP_IMG_DB

    if not ERP_MSSQL_USER or not ERP_MSSQL_PASS:
        print("ERP_MSSQL_USER/ERP_MSSQL_PASS nao configurados neste ambiente.", file=sys.stderr)
        return 1

    import pymssql

    print(f"== Descoberta Linx — brand={brand} host={host} db={db_name} (somente leitura) ==")
    with pymssql.connect(host, ERP_MSSQL_USER, ERP_MSSQL_PASS, db_name, timeout=30, login_timeout=10) as conn:
        cur = conn.cursor(as_dict=True)
        for title, query in QUERIES:
            print(f"\n===== {title} =====")
            cur.execute(query)
            _print_rows(cur.fetchall())

        if sku:
            print(f"\n===== [7] SKU real '{sku}' nas tabelas de produto =====")
            # Identifica tabelas de produto com colunas candidatas e procura o SKU nelas.
            cur.execute(
                "SELECT DISTINCT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE (COLUMN_NAME LIKE '%SKU%' OR COLUMN_NAME LIKE '%REFERENC%' OR COLUMN_NAME LIKE '%BARRA%') "
                "AND TABLE_NAME LIKE '%PRODUT%'"
            )
            for cand in cur.fetchall():
                table, col = cand["TABLE_NAME"], cand["COLUMN_NAME"]
                try:
                    cur.execute(
                        f"SELECT TOP 5 * FROM [{table}] WHERE [{col}] = %s",  # noqa: S608 — idents vindos do INFORMATION_SCHEMA
                        (sku,),
                    )
                    rows = cur.fetchall()
                    if rows:
                        print(f"\n-- match em {table}.{col}:")
                        _print_rows(rows)
                except Exception as exc:  # tabela sem SELECT permitido etc. — segue
                    print(f"  (pulado {table}.{col}: {exc})")

    print("\nPreencha no .env: LINX_PROP_COL_PRODUTO/PROPRIEDADE/VALOR conforme [1],")
    print("LINX_PRODUTO_COL_SKU conforme [6]/[7] (ou LINX_SKU_IS_PRODUTO=true), e por fim LINX_WRITE_ENABLED=true.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
