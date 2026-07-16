"""Application configuration via environment variables."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")

# --- Auth ---
API_KEY: str = os.environ.get("CERT_API_KEY", "")

# --- Database ---
DATABASE_URL: str = os.environ.get("DATABASE_URL", "")
REPORTS_DIR: Path = Path(os.environ.get("REPORTS_DIR", Path(__file__).parent.parent / "reports"))
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Directory where uploaded certificate PDFs are stored.
CERTS_DIR: Path = Path(os.environ.get("CERTS_DIR", Path(__file__).parent.parent / "certs"))
CERTS_DIR.mkdir(parents=True, exist_ok=True)

# --- Google Sheets ---
SHEETS_CLIENT_EMAIL: str = (
    os.environ.get("GOOGLE_SHEETS_CLIENT_EMAIL", "")
    or os.environ.get("GOOGLE_DRIVE_CLIENT_EMAIL", "")
)
SHEETS_PRIVATE_KEY: str = (
    os.environ.get("GOOGLE_SHEETS_PRIVATE_KEY", "")
    or os.environ.get("GOOGLE_DRIVE_PRIVATE_KEY", "")
).replace("\\n", "\n")
SHEETS_SPREADSHEET_ID: str = os.environ.get(
    "GOOGLE_SHEETS_SPREADSHEET_ID",
    "",
)

# --- VTEX ---
# Note: "puket escolares" must come before "puket" so exact match wins over substring
VTEX_STORES: dict[str, dict[str, str]] = {
    "puket escolares": {
        "domain": os.environ.get("VTEX_PUKET_DOMAIN", "www.puket.com.br"),
        "site_url": "https://www.puket.com.br",
    },
    "puket": {
        "domain": os.environ.get("VTEX_PUKET_DOMAIN", "www.puket.com.br"),
        "site_url": "https://www.puket.com.br",
    },
    "imaginarium": {
        "domain": os.environ.get("VTEX_IMAGINARIUM_DOMAIN", "loja.imaginarium.com.br"),
        "site_url": "https://loja.imaginarium.com.br",
    },
}
VTEX_REQUEST_DELAY: float = float(os.environ.get("VTEX_REQUEST_DELAY", "1.5"))

# --- WMS Oracle ---
# Production compose marks these as required. Keep Python defaults empty so this
# module does not bake real endpoints/credentials into local tests or images.
WMS_ORACLE_HOST: str = os.environ.get("WMS_ORACLE_HOST", "")
WMS_ORACLE_PORT: int = int(os.environ.get("WMS_ORACLE_PORT", "1521"))
WMS_ORACLE_SID: str = os.environ.get("WMS_ORACLE_SID", "")
WMS_ORACLE_USER: str = os.environ.get("WMS_ORACLE_USER", "")
WMS_ORACLE_PASS: str = os.environ.get("WMS_ORACLE_PASS", "")

# --- ERP SQL Server ---
ERP_PUKET_HOST: str = os.environ.get("ERP_PUKET_HOST", "")
ERP_PUKET_DB: str = os.environ.get("ERP_PUKET_DB", "")
ERP_IMG_HOST: str = os.environ.get("ERP_IMG_HOST", "")
ERP_IMG_DB: str = os.environ.get("ERP_IMG_DB", "")
ERP_MSSQL_USER: str = os.environ.get("ERP_MSSQL_USER", "")
ERP_MSSQL_PASS: str = os.environ.get("ERP_MSSQL_PASS", "")

# Puket (db01) e Imaginarium (db02) sao instancias SQL Server SEPARADAS, com logins
# separados: a mesma credencial nao atende as duas (confirmado em 2026-07-16 — a
# senha compartilhada autenticava so em uma delas por vez, deixando a outra marca
# fora do ar). Cada marca tem as suas; o ERP_MSSQL_* continua valendo como fallback
# para quem so tem um login para os dois.
ERP_PUKET_USER: str = os.environ.get("ERP_PUKET_USER", "") or ERP_MSSQL_USER
ERP_PUKET_PASS: str = os.environ.get("ERP_PUKET_PASS", "") or ERP_MSSQL_PASS
ERP_IMG_USER: str = os.environ.get("ERP_IMG_USER", "") or ERP_MSSQL_USER
ERP_IMG_PASS: str = os.environ.get("ERP_IMG_PASS", "") or ERP_MSSQL_PASS

# --- Linx ERP write (product properties) ---
# Master switch. Stays OFF until the PROP_PRODUTOS/PROPRIEDADE column names below
# are confirmed against production via sql/linx_discovery.sql. While OFF, certificates
# are saved in the portal (Postgres) but NOT written to Linx (linx_status='disabled').
LINX_WRITE_ENABLED: bool = os.environ.get("LINX_WRITE_ENABLED", "false").lower() == "true"

# Per-brand Linx connection + credentials + the PROPRIEDADE codes for each cert field.
# Codigos reconfirmados contra as duas bases em 2026-07-16 (PROPRIEDADE.TITULO_PROPRIEDADE):
# Puket 00224/00225, Imaginarium 00106/00107 — e NAO existe propriedade de "prazo de
# comercializacao" em nenhuma das duas.
# ATENCAO: cada entrada carrega `password`. Nunca logue o dict inteiro (log so `db`).
LINX_BRANDS: dict[str, dict[str, str]] = {
    "imaginarium": {
        "host": ERP_IMG_HOST,
        "db": ERP_IMG_DB,
        "user": ERP_IMG_USER,
        "password": ERP_IMG_PASS,
        "prop_validade_certificado": "00106",
        "prop_vencimento_licenciamento": "00107",
    },
    "puket": {
        "host": ERP_PUKET_HOST,
        "db": ERP_PUKET_DB,
        "user": ERP_PUKET_USER,
        "password": ERP_PUKET_PASS,
        "prop_validade_certificado": "00224",
        "prop_vencimento_licenciamento": "00225",
    },
    "puket escolares": {
        "host": ERP_PUKET_HOST,
        "db": ERP_PUKET_DB,
        "user": ERP_PUKET_USER,
        "password": ERP_PUKET_PASS,
        "prop_validade_certificado": "00224",
        "prop_vencimento_licenciamento": "00225",
    },
}

# PROP_PRODUTOS / PROPRIEDADE physical schema. Defaults are best-guess Linx names;
# CONFIRM/OVERRIDE via env after running sql/linx_discovery.sql. Identifiers are
# validated against ^[A-Za-z0-9_]+$ before being interpolated into SQL (see sqlserver.py).
LINX_SCHEMA: dict[str, str] = {
    # Tabela que liga produto <-> propriedade <-> valor
    "prop_table": os.environ.get("LINX_PROP_TABLE", "PROP_PRODUTOS"),
    "prop_col_produto": os.environ.get("LINX_PROP_COL_PRODUTO", "PRODUTO"),
    "prop_col_propriedade": os.environ.get("LINX_PROP_COL_PROPRIEDADE", "PROPRIEDADE"),
    "prop_col_valor": os.environ.get("LINX_PROP_COL_VALOR", "VALOR_PROPRIEDADE"),
    # 3a coluna da PK (PROPRIEDADE, PRODUTO, ITEM_PROPRIEDADE), smallint NOT NULL e
    # SEM default nas duas bases: todo INSERT precisa informa-la. E o indice de
    # multivalor da propriedade (a 00118 do Puket chega a 108 itens), mas as quatro
    # props de certificado sao single-valued e usam item=1 em 100% das 8510 linhas
    # existentes (conferido nas duas bases em 2026-07-16).
    "prop_col_item": os.environ.get("LINX_PROP_COL_ITEM", "ITEM_PROPRIEDADE"),
    "prop_item_value": os.environ.get("LINX_PROP_ITEM_VALUE", "1"),
    # Resolucao SKU -> codigo de produto "pai". Quando o SKU do portal ja e o
    # codigo do produto no Linx, deixe LINX_SKU_IS_PRODUTO=true e o resolver e no-op.
    "sku_is_produto": os.environ.get("LINX_SKU_IS_PRODUTO", "false"),
    "produto_table": os.environ.get("LINX_PRODUTO_TABLE", "PRODUTOS"),
    "produto_col_codigo": os.environ.get("LINX_PRODUTO_COL_CODIGO", "PRODUTO"),
    "produto_col_sku": os.environ.get("LINX_PRODUTO_COL_SKU", ""),
    # Formato em que a data e gravada no VALOR_PROPRIEDADE (campo texto no Linx).
    "date_format": os.environ.get("LINX_DATE_FORMAT", "%d/%m/%Y"),
}


def validate_linx_config() -> None:
    """Fail-fast guard for the Linx write go-live.

    Quando LINX_WRITE_ENABLED=true, toda coluna em que o upsert se apoia precisa
    estar configurada. Isso impede subir o cert-api com uma config parcial que
    gravaria na coluna errada do ERP ou falharia a resolucao de SKU em todo
    request. No-op enquanto LINX_WRITE_ENABLED=false (estado atual de producao).
    Chamado no startup (app/main.py).
    """
    if not LINX_WRITE_ENABLED:
        return

    missing: list[str] = []
    if not LINX_SCHEMA["prop_table"]:
        missing.append("LINX_PROP_TABLE")
    if not LINX_SCHEMA["prop_col_produto"]:
        missing.append("LINX_PROP_COL_PRODUTO")
    if not LINX_SCHEMA["prop_col_propriedade"]:
        missing.append("LINX_PROP_COL_PROPRIEDADE")
    if not LINX_SCHEMA["prop_col_valor"]:
        missing.append("LINX_PROP_COL_VALOR")
    if not LINX_SCHEMA["prop_col_item"]:
        missing.append("LINX_PROP_COL_ITEM")

    sku_is_produto = LINX_SCHEMA["sku_is_produto"].lower() == "true"
    if not sku_is_produto and not LINX_SCHEMA["produto_col_sku"]:
        missing.append("LINX_PRODUTO_COL_SKU (ou LINX_SKU_IS_PRODUTO=true)")

    # ITEM_PROPRIEDADE e smallint: um valor nao-inteiro so estouraria no INSERT, ja
    # com o certificado salvo no portal e a marca esperando a gravacao.
    try:
        int(LINX_SCHEMA["prop_item_value"])
    except (TypeError, ValueError):
        missing.append(
            f"LINX_PROP_ITEM_VALUE inteiro (recebido: {LINX_SCHEMA['prop_item_value']!r})"
        )

    # Sem credencial da marca o pymssql tentaria login anonimo e o erro sairia como
    # falha de rede, escondendo que o .env e que esta incompleto.
    for brand, cfg in LINX_BRANDS.items():
        if not cfg["user"] or not cfg["password"]:
            missing.append(
                f"credencial de '{brand}' (ERP_{'PUKET' if 'puket' in brand else 'IMG'}_USER/PASS "
                f"ou o fallback ERP_MSSQL_USER/PASS)"
            )
            break

    if missing:
        raise RuntimeError(
            "LINX_WRITE_ENABLED=true mas a configuracao de schema do Linx esta "
            "incompleta. Defina: " + ", ".join(missing) + ". "
            "Rode apps/cert-api/sql/linx_discovery.sql para descobrir os nomes reais "
            "das colunas de PROP_PRODUTOS/PRODUTOS antes de ligar a escrita."
        )

# --- CORS ---
_cors_origins_env: str = os.environ.get("CORS_ORIGINS", "")
CORS_ORIGINS: list[str] = (
    [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
    if _cors_origins_env
    else ["http://localhost:5173", "http://localhost:8080"]
)

# Certification keywords used to find cert info in product pages
CERT_KEYWORDS: list[str] = [
    "inmetro", "certificação", "certificacao", "registro",
    "portaria", "conformidade", "selo", "norma",
    "nbr", "abnt", "anvisa", "certificado", "homologação",
    "homologacao", "regulamento", "oc ", "ocp ",
]

# Spec field names that directly contain certification info
CERT_SPEC_NAMES: list[str] = [
    "certificação inmetro", "certificacao inmetro",
    "certificação", "certificacao",
    "registro inmetro", "selo inmetro",
    "homologação anatel", "homologacao anatel",
    "registro anvisa",
]
