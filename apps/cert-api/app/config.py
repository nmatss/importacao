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
    "1qcgcj9814UFikhurgvsTTcUxvPF2r3w_QY_EurvBtSE",
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
WMS_ORACLE_HOST: str = os.environ.get("WMS_ORACLE_HOST", "192.168.168.10")
WMS_ORACLE_PORT: int = int(os.environ.get("WMS_ORACLE_PORT", "1521"))
WMS_ORACLE_SID: str = os.environ.get("WMS_ORACLE_SID", "WMS")
WMS_ORACLE_USER: str = os.environ.get("WMS_ORACLE_USER", "wisweb")
WMS_ORACLE_PASS: str = os.environ.get("WMS_ORACLE_PASS", "wisweb")

# --- ERP SQL Server ---
ERP_PUKET_HOST: str = os.environ.get("ERP_PUKET_HOST", "db01.grupounico.com")
ERP_PUKET_DB: str = os.environ.get("ERP_PUKET_DB", "DB_puket")
ERP_IMG_HOST: str = os.environ.get("ERP_IMG_HOST", "db02.grupounico.com")
ERP_IMG_DB: str = os.environ.get("ERP_IMG_DB", "Grupo_Imaginarium")
ERP_MSSQL_USER: str = os.environ.get("ERP_MSSQL_USER", "nicolas.matsuda")
ERP_MSSQL_PASS: str = os.environ.get("ERP_MSSQL_PASS", "")

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
