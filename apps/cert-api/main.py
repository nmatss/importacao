"""
Cert-API: Microservice for product certification validation.
Validates certification info on VTEX e-commerce sites against Google Sheets data.
"""

import os
import re
import uuid
import json
import time
import threading
import logging
import difflib
from html import unescape
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager

import requests
import psycopg2
import psycopg2.extras
import gspread
from google.oauth2.service_account import Credentials
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

log = logging.getLogger("cert-api")
logging.basicConfig(level=logging.INFO)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Cert-API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL", "")
REPORTS_DIR = Path("/app/reports")
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Google Sheets config
SHEETS_CLIENT_EMAIL = os.environ.get("GOOGLE_SHEETS_CLIENT_EMAIL", "")
SHEETS_PRIVATE_KEY = os.environ.get("GOOGLE_SHEETS_PRIVATE_KEY", "").replace("\\n", "\n")
SHEETS_SPREADSHEET_ID = os.environ.get(
    "GOOGLE_SHEETS_SPREADSHEET_ID",
    "1qcgcj9814UFikhurgvsTTcUxvPF2r3w_QY_EurvBtSE",
)

# VTEX config — brand → store domain mapping
VTEX_STORES: dict[str, dict] = {
    "puket": {
        "domain": os.environ.get("VTEX_PUKET_DOMAIN", "www.puket.com.br"),
        "site_url": "https://www.puket.com.br",
    },
    "puket escolares": {
        "domain": os.environ.get("VTEX_PUKET_DOMAIN", "www.puket.com.br"),
        "site_url": "https://www.puket.com.br",
    },
    "imaginarium": {
        "domain": os.environ.get("VTEX_IMAGINARIUM_DOMAIN", "loja.imaginarium.com.br"),
        "site_url": "https://loja.imaginarium.com.br",
    },
}

VTEX_REQUEST_DELAY = float(os.environ.get("VTEX_REQUEST_DELAY", "1.5"))

# Certification keywords to search for in product pages
CERT_KEYWORDS = [
    "inmetro", "certificação", "certificacao", "registro",
    "portaria", "conformidade", "selo", "norma",
    "nbr", "abnt", "anvisa", "certificado", "homologação",
    "homologacao", "regulamento", "oc ", "ocp ",
]

# In-memory store for running validations
_running_validations: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_conn():
    return psycopg2.connect(DATABASE_URL)


@contextmanager
def db():
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _add_column_if_not_exists(col: str, coltype: str):
    try:
        c = get_conn()
        with c.cursor() as cur:
            cur.execute(f"ALTER TABLE cert_products ADD COLUMN IF NOT EXISTS {col} {coltype}")
        c.commit()
        c.close()
    except Exception:
        pass


def ensure_tables():
    """Create cert tables if they don't exist."""
    with db() as (conn, cur):
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_products (
                sku TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                brand TEXT NOT NULL DEFAULT '',
                certification_type TEXT DEFAULT '',
                sheet_status TEXT DEFAULT '',
                expected_cert_text TEXT DEFAULT '',
                actual_cert_text TEXT DEFAULT '',
                last_validation_status TEXT,
                last_validation_score DOUBLE PRECISION,
                last_validation_url TEXT,
                last_validation_date TIMESTAMPTZ,
                last_validation_error TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                brand_filter TEXT,
                cron_expression TEXT NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                last_run TIMESTAMPTZ,
                next_run TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_schedule_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                schedule_id UUID REFERENCES cert_schedules(id) ON DELETE CASCADE,
                run_date TIMESTAMPTZ DEFAULT NOW(),
                status TEXT DEFAULT 'completed',
                summary JSONB,
                report_file TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_validation_runs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                status TEXT DEFAULT 'pending',
                brand_filter TEXT,
                total INTEGER DEFAULT 0,
                processed INTEGER DEFAULT 0,
                ok INTEGER DEFAULT 0,
                missing INTEGER DEFAULT 0,
                inconsistent INTEGER DEFAULT 0,
                not_found INTEGER DEFAULT 0,
                started_at TIMESTAMPTZ DEFAULT NOW(),
                finished_at TIMESTAMPTZ,
                report_file TEXT
            )
        """)

    # Migration: add columns for existing deployments
    for col, coltype in [
        ("certification_type", "TEXT DEFAULT ''"),
        ("sheet_status", "TEXT DEFAULT ''"),
        ("expected_cert_text", "TEXT DEFAULT ''"),
        ("actual_cert_text", "TEXT DEFAULT ''"),
        ("last_validation_error", "TEXT"),
    ]:
        _add_column_if_not_exists(col, coltype)


# ---------------------------------------------------------------------------
# Google Sheets helpers
# ---------------------------------------------------------------------------

def _get_sheets_client() -> gspread.Client | None:
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


def _read_products_from_sheets() -> list[dict]:
    client = _get_sheets_client()
    if not client:
        return []
    try:
        spreadsheet = client.open_by_key(SHEETS_SPREADSHEET_ID)
    except Exception as e:
        log.error(f"Failed to open spreadsheet: {e}")
        return []

    products: list[dict] = []
    worksheet_configs = [
        {
            "name": "Imaginarium",
            "sku_col": 2, "name_col": 5, "brand_col": 0,
            "brand_default": "Imaginarium",
            "cert_type_col": 7, "status_col": 9,
        },
        {
            "name": "Puket",
            "sku_col": 2, "name_col": 5, "brand_col": 0,
            "brand_default": "Puket",
            "cert_type_col": 7, "status_col": 9,
        },
        {
            "name": "Puket escolares",
            "sku_col": 0, "name_col": 1, "brand_col": None,
            "brand_default": "Puket Escolares",
            "cert_type_col": 2, "status_col": 6,
        },
    ]

    for cfg in worksheet_configs:
        try:
            ws = spreadsheet.worksheet(cfg["name"])
            rows = ws.get_all_values()
        except Exception as e:
            log.warning(f"Could not read worksheet '{cfg['name']}': {e}")
            continue

        for row in rows[1:]:
            sku_col = cfg["sku_col"]
            if sku_col >= len(row):
                continue
            sku = str(row[sku_col]).strip()
            if not sku:
                continue

            name = str(row[cfg["name_col"]]).strip() if cfg["name_col"] < len(row) else ""
            if cfg["brand_col"] is not None and cfg["brand_col"] < len(row):
                brand = str(row[cfg["brand_col"]]).strip() or cfg["brand_default"]
            else:
                brand = cfg["brand_default"]
            cert_type = str(row[cfg["cert_type_col"]]).strip() if cfg["cert_type_col"] < len(row) else ""
            sheet_status = str(row[cfg["status_col"]]).strip() if cfg["status_col"] < len(row) else ""

            products.append({
                "sku": sku,
                "name": name,
                "brand": brand,
                "certification_type": cert_type,
                "sheet_status": sheet_status,
            })

    log.info(f"Read {len(products)} products from Google Sheets")
    return products


def sync_sheets_to_db() -> dict:
    products = _read_products_from_sheets()
    if not products:
        return {"synced": 0, "error": "No products found or Sheets not configured"}
    if not DATABASE_URL:
        return {"synced": 0, "error": "Database not configured"}

    try:
        with db() as (conn, cur):
            for p in products:
                cur.execute(
                    """
                    INSERT INTO cert_products (sku, name, brand, certification_type, expected_cert_text, sheet_status, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (sku) DO UPDATE SET
                        name = EXCLUDED.name,
                        brand = EXCLUDED.brand,
                        certification_type = EXCLUDED.certification_type,
                        expected_cert_text = EXCLUDED.expected_cert_text,
                        sheet_status = EXCLUDED.sheet_status,
                        updated_at = NOW()
                    """,
                    [p["sku"], p["name"], p["brand"], p["certification_type"], p["certification_type"], p["sheet_status"]],
                )
        return {"synced": len(products), "total_rows": len(products)}
    except Exception as e:
        log.error(f"Failed to sync sheets to DB: {e}")
        return {"synced": 0, "error": str(e)}


# ---------------------------------------------------------------------------
# VTEX integration
# ---------------------------------------------------------------------------

def _get_vtex_config(brand: str) -> dict | None:
    brand_lower = brand.lower().strip()
    for key, config in VTEX_STORES.items():
        if key in brand_lower or brand_lower in key:
            return config
    return None


def _strip_html(html_text: str, keep_newlines: bool = False) -> str:
    if not html_text:
        return ""
    if keep_newlines:
        # Replace <br>, <p>, <div>, <li> etc. with newlines, other tags with space
        text = re.sub(r'<br\s*/?>|</p>|</div>|</li>|</tr>', '\n', html_text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = unescape(text)
        # Collapse multiple spaces within each line, but preserve newlines
        lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in text.split('\n')]
        return '\n'.join(line for line in lines if line)
    text = re.sub(r'<[^>]+>', ' ', html_text)
    text = unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _vtex_search_product(sku: str, brand: str) -> dict | None:
    """Search for a product by SKU on VTEX using the Intelligent Search API."""
    config = _get_vtex_config(brand)
    if not config:
        log.warning(f"No VTEX config for brand '{brand}'")
        return None

    domain = config["domain"]
    headers = {"Accept": "application/json", "User-Agent": "CertAPI/2.0"}

    # 1. Primary: Intelligent Search API (works with partial SKU/ref codes)
    try:
        url = f"https://{domain}/api/io/_v/api/intelligent-search/product_search/"
        resp = requests.get(url, params={"query": sku, "count": 5}, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            products = data.get("products", [])
            if products:
                # Find best match: product whose reference starts with our SKU
                for p in products:
                    ref = (p.get("productReference") or "").lower()
                    if ref.startswith(sku.lower()) or sku.lower() in ref:
                        p["_vtex_config"] = config
                        p["_search_api"] = "intelligent"
                        return p
                # If no ref match, return first result
                products[0]["_vtex_config"] = config
                products[0]["_search_api"] = "intelligent"
                return products[0]
    except requests.RequestException as e:
        log.warning(f"VTEX intelligent search ({sku}) failed: {e}")

    # 2. Fallback: Catalog System API with RefId
    try:
        url = f"https://{domain}/api/catalog_system/pub/products/search"
        resp = requests.get(url, params={"fq": f"alternateIds_RefId:{sku}"}, headers=headers, timeout=15)
        if resp.status_code in (200, 206):
            data = resp.json()
            if data:
                data[0]["_vtex_config"] = config
                data[0]["_search_api"] = "catalog"
                return data[0]
    except requests.RequestException as e:
        log.warning(f"VTEX catalog search ({sku}) failed: {e}")

    return None


def _extract_cert_sentences(text: str) -> list[str]:
    """Extract only sentences/fragments that contain certification keywords from a block of text."""
    if not text:
        return []
    # Split by common delimiters: newlines, periods, semicolons, pipes
    fragments = re.split(r'[\n;|]+|(?<=\.)\s+', text)
    results = []
    for frag in fragments:
        frag = frag.strip().rstrip('.')
        if not frag or len(frag) < 5:
            continue
        frag_lower = frag.lower()
        if any(kw in frag_lower for kw in CERT_KEYWORDS):
            results.append(frag.strip())
    return results


def _extract_cert_text_from_vtex(product_data: dict) -> str:
    """Extract all certification-related text from VTEX product data."""
    found_texts: list[str] = []
    api_type = product_data.get("_search_api", "intelligent")

    if api_type == "intelligent":
        # Intelligent Search API response format

        # 1. Check description — use keep_newlines to preserve structure
        desc = _strip_html(product_data.get("description", ""), keep_newlines=True)
        found_texts.extend(_extract_cert_sentences(desc))

        # 2. Check properties (dedicated cert fields)
        for prop in (product_data.get("properties") or []):
            if isinstance(prop, dict):
                name = prop.get("name", "")
                values = prop.get("values", [])
                for val in values:
                    val_str = _strip_html(str(val))
                    if any(kw in val_str.lower() for kw in CERT_KEYWORDS) or any(kw in name.lower() for kw in CERT_KEYWORDS):
                        found_texts.append(f"{name}: {val_str}")

        # 3. Check specificationGroups
        for group in (product_data.get("specificationGroups") or []):
            if isinstance(group, dict):
                for spec in (group.get("specifications") or []):
                    if isinstance(spec, dict):
                        name = spec.get("name", "")
                        values = spec.get("values", [])
                        for val in values:
                            val_str = _strip_html(str(val))
                            if any(kw in val_str.lower() for kw in CERT_KEYWORDS) or any(kw in name.lower() for kw in CERT_KEYWORDS):
                                found_texts.append(f"{name}: {val_str}")

        # 4. Check items (SKU-level) — complementName is key for certification text
        for item in (product_data.get("items") or []):
            if isinstance(item, dict):
                comp_raw = item.get("complementName", "")
                if not comp_raw:
                    continue
                # Use keep_newlines to preserve line structure in complementName
                comp = _strip_html(comp_raw, keep_newlines=True)
                cert_sentences = _extract_cert_sentences(comp)
                if cert_sentences:
                    found_texts.extend(cert_sentences)

    else:
        # Catalog System API response format (legacy fallback)
        desc = _strip_html(product_data.get("description", ""), keep_newlines=True)
        found_texts.extend(_extract_cert_sentences(desc))

        all_specs = product_data.get("allSpecifications", [])
        for spec_name in all_specs:
            spec_values = product_data.get(spec_name, [])
            if isinstance(spec_values, list):
                for val in spec_values:
                    val_str = _strip_html(str(val))
                    if any(kw in val_str.lower() for kw in CERT_KEYWORDS) or any(kw in spec_name.lower() for kw in CERT_KEYWORDS):
                        found_texts.append(f"{spec_name}: {val_str}")

        for item in (product_data.get("items") or []):
            comp_raw = item.get("complementName", "")
            if not comp_raw:
                continue
            comp = _strip_html(comp_raw, keep_newlines=True)
            cert_sentences = _extract_cert_sentences(comp)
            if cert_sentences:
                found_texts.extend(cert_sentences)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for t in found_texts:
        t_clean = t.strip()
        if t_clean and t_clean not in seen:
            seen.add(t_clean)
            unique.append(t_clean)

    return " | ".join(unique) if unique else ""


def _build_product_url(product_data: dict) -> str:
    """Build the product page URL from VTEX data."""
    config = product_data.get("_vtex_config", {})
    site_url = config.get("site_url", "")
    link = product_data.get("link", "")

    if link and link.startswith("http"):
        return link
    if link and site_url:
        return f"{site_url}{link}"
    link_text = product_data.get("linkText", "")
    if link_text and site_url:
        return f"{site_url}/{link_text}/p"
    return ""


def _extract_cert_body(text: str) -> set[str]:
    """Identify which certification bodies are mentioned in a text."""
    bodies = set()
    lower = text.lower()
    for body in ("inmetro", "anvisa", "anatel", "abnt"):
        if body in lower:
            bodies.add(body)
    # OCP / BRICS are INMETRO-accredited certification bodies
    # "Produto certificado por BRICS OCP 0098" → INMETRO
    if "inmetro" not in bodies and ("ocp " in lower or "brics" in lower):
        bodies.add("inmetro")
    return bodies


def _has_registration_number(text: str) -> bool:
    """Check if text contains a registration/certificate number pattern."""
    # Patterns: 006083/2024, Nº 12345, Registro 006083, OCP 0098, Anatel: 07388-24-15956, etc.
    patterns = [
        r'\d{4,}/\d{4}',                       # 006083/2024
        r'n[°ºo]\s*\.?\s*\d{3,}',              # Nº 006083
        r'registro\s+\d{3,}',                   # Registro 006083
        r'ocp\s+\d{3,}',                       # OCP 0098
        r'certificado\s+(?:n[°ºo]?\s*)?\.?\s*\d{3,}',  # Certificado Nº 12345
        r'homologa[çc][ãa]o[^:]*:\s*\d{3,}',   # homologação Anatel: 07388-24-15956
        r'\d{4,}-\d{2}-\d{4,}',                # 07388-24-15956 (Anatel code format)
        r'ce-\w+[\s/]\w+\s+\d{3,}',            # CE-BRI/BRICS 01180-20 (certificate number)
    ]
    lower = text.lower()
    return any(re.search(p, lower) for p in patterns)


def _compare_cert_texts(expected: str, actual: str) -> tuple[str, float]:
    """
    Compare expected certification type with actual text found on site.

    Key insight: 'expected' is typically a cert TYPE from the spreadsheet
    (e.g. "INMETRO BRINQUEDOS SISTEMA 5 (FÁBRICA) - PORTARIA 302")
    while 'actual' is the cert text FROM THE SITE
    (e.g. "Certificação INMETRO: Produto certificado por BRICS OCP 0098 Nº Registro 006083/2024").

    These are different kinds of information, so we compare by:
    1. Whether the same certification body is present (INMETRO, ANVISA, etc.)
    2. Whether the site has a valid registration number
    3. Whether specific portaria/regulation numbers match

    Returns (status, score).
    """
    if not expected:
        return ("NO_EXPECTED", 0.0)
    if not actual:
        return ("MISSING", 0.0)

    exp_lower = expected.lower().strip()
    act_lower = actual.lower().strip()

    # 1. Check if expected has specific registration numbers that should appear on site
    exp_reg_numbers = re.findall(r'\d{4,}/\d{4}', expected)
    if exp_reg_numbers:
        found_count = sum(1 for num in exp_reg_numbers if num in actual)
        if found_count == len(exp_reg_numbers):
            return ("OK", 1.0)

    # 2. Check certification body match (most important check)
    exp_bodies = _extract_cert_body(expected)
    act_bodies = _extract_cert_body(actual)
    matching_bodies = exp_bodies & act_bodies
    actual_has_reg = _has_registration_number(actual)

    # If same cert body AND the site shows a registration number → OK
    # This is the typical case: expected="INMETRO BRINQUEDOS ...", actual="Certificação INMETRO: ... Nº Registro 006083/2024"
    if matching_bodies and actual_has_reg:
        return ("OK", 0.95)

    # If same cert body but no registration number → INCONSISTENT (cert mentioned but incomplete)
    if matching_bodies and not actual_has_reg:
        return ("INCONSISTENT", 0.6)

    # If expected doesn't mention any cert body (just a product type like "ESTOJO")
    # but actual has a cert body + registration number → product is certified
    if not exp_bodies and act_bodies and actual_has_reg:
        return ("OK", 0.9)

    # 3. Check for portaria numbers
    portaria_expected = re.findall(r'portaria\s*(?:n[°º.]?\s*)?(\d+)', exp_lower)
    if portaria_expected:
        portaria_found = all(
            re.search(rf'(?:portaria|port\.?)\s*(?:n[°º.]?\s*)?{num}', act_lower)
            for num in portaria_expected
        )
        if portaria_found:
            return ("OK", 0.9)

    # 4. Word overlap + sequence similarity for other cases
    exp_words = set(w for w in re.findall(r'\w+', exp_lower) if len(w) > 3)
    act_words = set(w for w in re.findall(r'\w+', act_lower) if len(w) > 3)

    if exp_words:
        overlap = exp_words & act_words
        word_score = len(overlap) / len(exp_words)
    else:
        word_score = 0.0

    seq_score = difflib.SequenceMatcher(None, exp_lower, act_lower).ratio()
    score = max(word_score, seq_score)

    # If actual has a registration number from ANY cert body, slight boost
    if actual_has_reg and score >= 0.2:
        score = max(score, 0.5)

    # Determine status
    if score >= 0.7:
        return ("OK", score)
    elif score >= 0.3:
        return ("INCONSISTENT", score)
    else:
        return ("MISSING", score)


def validate_single_product(sku: str, brand: str, expected_cert: str) -> dict:
    """
    Validate a single product against VTEX.
    Returns dict with: status, score, url, actual_cert_text, error.
    """
    now = datetime.now(timezone.utc)
    result = {
        "sku": sku,
        "brand": brand,
        "status": "URL_NOT_FOUND",
        "score": 0.0,
        "url": None,
        "actual_cert_text": None,
        "expected_cert_text": expected_cert or None,
        "error": None,
        "verified_at": now.isoformat(),
    }

    if not expected_cert:
        result["status"] = "NO_EXPECTED"
        return result

    config = _get_vtex_config(brand)
    if not config:
        result["status"] = "API_ERROR"
        result["error"] = f"No VTEX store configured for brand '{brand}'"
        return result

    try:
        vtex_product = _vtex_search_product(sku, brand)
    except Exception as e:
        result["status"] = "API_ERROR"
        result["error"] = f"VTEX API error: {str(e)}"
        return result

    if not vtex_product:
        result["status"] = "URL_NOT_FOUND"
        result["error"] = f"Product SKU {sku} not found on {config['domain']}"
        return result

    # Build product URL
    result["url"] = _build_product_url(vtex_product)

    # Extract certification text from VTEX product
    actual_cert = _extract_cert_text_from_vtex(vtex_product)
    result["actual_cert_text"] = actual_cert if actual_cert else None

    # Compare expected vs actual
    status, score = _compare_cert_texts(expected_cert, actual_cert)
    result["status"] = status
    result["score"] = round(score, 3)

    if status == "MISSING" and result["url"]:
        result["error"] = "No certification text found on product page"
    elif status == "INCONSISTENT":
        result["error"] = "Certification text found but does not match expected"

    return result


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
def startup():
    if DATABASE_URL:
        try:
            ensure_tables()
        except Exception as e:
            log.warning(f"Could not create tables: {e}")

    if SHEETS_CLIENT_EMAIL and SHEETS_PRIVATE_KEY:
        try:
            result = sync_sheets_to_db()
            log.info(f"Startup sheets sync: {result}")
        except Exception as e:
            log.warning(f"Startup sheets sync failed: {e}")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    result = {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
    if DATABASE_URL:
        try:
            conn = get_conn()
            conn.close()
            result["database"] = "connected"
        except Exception:
            result["database"] = "disconnected"
    result["sheets_configured"] = bool(SHEETS_CLIENT_EMAIL and SHEETS_PRIVATE_KEY)
    result["vtex_stores"] = list(VTEX_STORES.keys())
    return result


# ---------------------------------------------------------------------------
# Sheets sync
# ---------------------------------------------------------------------------

@app.post("/api/sync-sheets")
def trigger_sync_sheets():
    if not SHEETS_CLIENT_EMAIL or not SHEETS_PRIVATE_KEY:
        raise HTTPException(400, "Google Sheets credentials not configured")
    result = sync_sheets_to_db()
    if result.get("error"):
        raise HTTPException(500, result["error"])
    return result


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@app.get("/api/stats")
def get_stats():
    if not DATABASE_URL:
        return _empty_stats()
    try:
        with db() as (conn, cur):
            cur.execute("SELECT COUNT(*) as cnt FROM cert_products")
            total = cur.fetchone()["cnt"]

            cur.execute("""
                SELECT * FROM cert_validation_runs
                WHERE status = 'completed'
                ORDER BY finished_at DESC NULLS LAST
                LIMIT 1
            """)
            last_run_row = cur.fetchone()

            last_run = None
            if last_run_row:
                last_run = {
                    "date": (last_run_row["finished_at"] or last_run_row["started_at"]).isoformat(),
                    "total": last_run_row["total"],
                    "ok": last_run_row["ok"],
                    "missing": last_run_row["missing"],
                    "inconsistent": last_run_row["inconsistent"],
                    "not_found": last_run_row["not_found"],
                }

            cur.execute("""
                SELECT brand,
                    COUNT(*) FILTER (WHERE last_validation_status = 'OK') as ok,
                    COUNT(*) FILTER (WHERE last_validation_status = 'MISSING') as missing,
                    COUNT(*) FILTER (WHERE last_validation_status = 'INCONSISTENT') as inconsistent,
                    COUNT(*) FILTER (WHERE last_validation_status NOT IN ('OK','MISSING','INCONSISTENT') OR last_validation_status IS NULL) as not_found
                FROM cert_products
                WHERE brand != ''
                GROUP BY brand
                ORDER BY brand
            """)
            by_brand = [dict(r) for r in cur.fetchall()]

            return {
                "total_products": total,
                "last_run": last_run,
                "by_brand": by_brand,
            }
    except Exception:
        return _empty_stats()


def _empty_stats():
    return {"total_products": 0, "last_run": None, "by_brand": []}


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

def _serialize_product(r: dict) -> dict:
    for dtfield in ("last_validation_date", "created_at", "updated_at"):
        if r.get(dtfield):
            r[dtfield] = r[dtfield].isoformat()
    return r


@app.get("/api/products")
def list_products(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: str = Query(""),
    brand: str = Query(""),
    status: str = Query(""),
):
    if not DATABASE_URL:
        return {"products": [], "total": 0, "page": 1, "per_page": per_page, "total_pages": 0, "last_validation_date": None}

    with db() as (conn, cur):
        conditions = []
        params: list = []

        if search:
            conditions.append("(sku ILIKE %s OR name ILIKE %s)")
            params.extend([f"%{search}%", f"%{search}%"])
        if brand:
            conditions.append("LOWER(brand) = LOWER(%s)")
            params.append(brand)
        if status:
            statuses = [s.strip() for s in status.split(",") if s.strip()]
            if statuses:
                conditions.append("last_validation_status IN ({})".format(",".join(["%s"] * len(statuses))))
                params.extend(statuses)

        where = "WHERE " + " AND ".join(conditions) if conditions else ""

        cur.execute(f"SELECT COUNT(*) as cnt FROM cert_products {where}", params)
        total = cur.fetchone()["cnt"]

        offset = (page - 1) * per_page
        cur.execute(
            f"SELECT * FROM cert_products {where} ORDER BY sku LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        rows = [_serialize_product(dict(r)) for r in cur.fetchall()]

        cur.execute("SELECT MAX(last_validation_date) as last_date FROM cert_products")
        last_date_row = cur.fetchone()
        last_date = last_date_row["last_date"].isoformat() if last_date_row and last_date_row["last_date"] else None

        total_pages = max(1, (total + per_page - 1) // per_page)

        return {
            "products": rows,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
            "last_validation_date": last_date,
        }


@app.get("/api/products/{sku}")
def get_product(sku: str):
    if not DATABASE_URL:
        raise HTTPException(404, "Product not found")

    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_products WHERE sku = %s", [sku])
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        result = _serialize_product(dict(row))

        # Build last_validation object for frontend detail page
        if result.get("last_validation_status"):
            result["last_validation"] = {
                "status": result["last_validation_status"],
                "score": result.get("last_validation_score"),
                "url": result.get("last_validation_url"),
                "actual_cert_text": result.get("actual_cert_text"),
                "error": result.get("last_validation_error"),
                "date": result.get("last_validation_date"),
            }
        return result


class VerifyRequest(BaseModel):
    sku: str
    brand: str


@app.post("/api/products/verify")
def verify_product(req: VerifyRequest):
    """Verify a single product against the VTEX e-commerce site in real time."""
    now = datetime.now(timezone.utc)

    # Get expected cert text from DB
    expected_cert = ""
    if DATABASE_URL:
        try:
            with db() as (conn, cur):
                cur.execute("SELECT certification_type, brand FROM cert_products WHERE sku = %s", [req.sku])
                row = cur.fetchone()
                if row:
                    expected_cert = row.get("certification_type", "") or ""
        except Exception:
            pass

    # Real VTEX validation
    result = validate_single_product(req.sku, req.brand, expected_cert)

    # Save result to DB
    if DATABASE_URL:
        try:
            with db() as (conn, cur):
                cur.execute(
                    """
                    UPDATE cert_products
                    SET last_validation_status = %s,
                        last_validation_score = %s,
                        last_validation_url = %s,
                        last_validation_date = %s,
                        last_validation_error = %s,
                        actual_cert_text = %s,
                        updated_at = %s
                    WHERE sku = %s
                    """,
                    [result["status"], result["score"], result["url"],
                     now, result["error"], result.get("actual_cert_text"),
                     now, req.sku],
                )
        except Exception as e:
            log.error(f"Failed to update product {req.sku}: {e}")

    return result


# ---------------------------------------------------------------------------
# Validation runs
# ---------------------------------------------------------------------------

class ValidateRequest(BaseModel):
    brand: str | None = None
    limit: int | None = None
    source: str | None = None


@app.post("/api/validate")
def start_validation(req: ValidateRequest):
    run_id = str(uuid.uuid4())

    if DATABASE_URL:
        with db() as (conn, cur):
            cur.execute(
                "INSERT INTO cert_validation_runs (id, status, brand_filter) VALUES (%s, 'running', %s)",
                [run_id, req.brand],
            )

    _running_validations[run_id] = {"status": "running", "events": [], "processed": 0, "total": 0}
    thread = threading.Thread(
        target=_run_validation, args=(run_id, req.brand, req.limit, req.source), daemon=True
    )
    thread.start()

    return {"run_id": run_id, "status": "running"}


def _run_validation(run_id: str, brand_filter: str | None, limit: int | None, source: str | None = None):
    """Background validation — queries VTEX for each product."""
    state = _running_validations[run_id]
    try:
        # Sync from sheets if requested
        if source == "sheets" and SHEETS_CLIENT_EMAIL and SHEETS_PRIVATE_KEY:
            try:
                sync_result = sync_sheets_to_db()
                log.info(f"Pre-validation sheets sync: {sync_result}")
            except Exception as e:
                log.warning(f"Pre-validation sheets sync failed: {e}")

        products = []
        if DATABASE_URL:
            with db() as (conn, cur):
                conditions = []
                params: list = []
                if brand_filter:
                    conditions.append("LOWER(brand) = LOWER(%s)")
                    params.append(brand_filter)
                where = "WHERE " + " AND ".join(conditions) if conditions else ""
                sql = f"SELECT sku, name, brand, certification_type FROM cert_products {where} ORDER BY sku"
                if limit:
                    sql += f" LIMIT {int(limit)}"
                cur.execute(sql, params)
                products = [dict(r) for r in cur.fetchall()]

        state["total"] = len(products)
        ok = missing = inconsistent = not_found = 0
        now = datetime.now(timezone.utc)
        report_products = []

        for i, p in enumerate(products):
            sku = p["sku"]
            brand = p["brand"]
            expected_cert = p.get("certification_type", "") or ""

            # Real VTEX validation
            vresult = validate_single_product(sku, brand, expected_cert)

            status = vresult["status"]
            score = vresult["score"]

            if status == "OK":
                ok += 1
            elif status == "MISSING":
                missing += 1
            elif status == "INCONSISTENT":
                inconsistent += 1
            else:
                not_found += 1

            state["processed"] = i + 1
            event = {
                "type": "progress",
                "current": i + 1,
                "total": len(products),
                "product": {"sku": sku, "name": p["name"], "status": status, "score": score},
            }
            state["events"].append(event)

            report_products.append({
                "sku": sku,
                "name": p["name"],
                "brand": brand,
                "status": status,
                "score": score,
                "url": vresult.get("url"),
                "actual_cert_text": vresult.get("actual_cert_text"),
                "expected_cert_text": expected_cert,
                "error": vresult.get("error"),
            })

            # Update product in DB
            if DATABASE_URL:
                try:
                    with db() as (conn, cur):
                        cur.execute(
                            """
                            UPDATE cert_products
                            SET last_validation_status = %s,
                                last_validation_score = %s,
                                last_validation_url = %s,
                                last_validation_date = %s,
                                last_validation_error = %s,
                                actual_cert_text = %s,
                                updated_at = %s
                            WHERE sku = %s
                            """,
                            [status, score, vresult.get("url"), now,
                             vresult.get("error"), vresult.get("actual_cert_text"),
                             now, sku],
                        )
                except Exception:
                    pass

            # Rate limit: delay between VTEX requests
            if i < len(products) - 1:
                time.sleep(VTEX_REQUEST_DELAY)

        summary = {
            "total": len(products),
            "ok": ok,
            "missing": missing,
            "inconsistent": inconsistent,
            "not_found": not_found,
        }

        # Save report
        report_filename = f"validation_{run_id[:8]}_{now.strftime('%Y%m%d_%H%M%S')}.json"
        report_path = REPORTS_DIR / report_filename
        report_data = {
            "run_id": run_id,
            "date": now.isoformat(),
            "summary": summary,
            "products": report_products,
        }
        report_path.write_text(json.dumps(report_data, indent=2, ensure_ascii=False))

        # Update run in DB
        if DATABASE_URL:
            try:
                with db() as (conn, cur):
                    cur.execute(
                        """
                        UPDATE cert_validation_runs
                        SET status = 'completed', total = %s, ok = %s, missing = %s,
                            inconsistent = %s, not_found = %s, finished_at = %s, report_file = %s
                        WHERE id = %s
                        """,
                        [len(products), ok, missing, inconsistent, not_found,
                         datetime.now(timezone.utc), report_filename, run_id],
                    )
            except Exception:
                pass

        state["status"] = "completed"
        state["events"].append({"type": "complete", "summary": summary})

    except Exception as e:
        log.error(f"Validation run {run_id} failed: {e}", exc_info=True)
        state["status"] = "error"
        state["events"].append({"type": "error", "error": str(e)})


@app.get("/api/validate/{run_id}")
def get_validation_status(run_id: str):
    state = _running_validations.get(run_id)
    if state:
        return {
            "run_id": run_id,
            "status": state["status"],
            "processed": state["processed"],
            "total": state["total"],
        }

    if DATABASE_URL:
        with db() as (conn, cur):
            cur.execute("SELECT * FROM cert_validation_runs WHERE id = %s", [run_id])
            row = cur.fetchone()
            if row:
                return {
                    "run_id": run_id,
                    "status": row["status"],
                    "processed": row["total"],
                    "total": row["total"],
                }

    raise HTTPException(404, "Validation run not found")


@app.get("/api/validate/{run_id}/stream")
def stream_validation(run_id: str):
    """Server-Sent Events stream for validation progress."""
    state = _running_validations.get(run_id)
    if not state:
        raise HTTPException(404, "Validation run not found or already finished")

    def event_generator():
        sent = 0
        while True:
            events = state["events"]
            while sent < len(events):
                event = events[sent]
                yield f"data: {json.dumps(event)}\n\n"
                sent += 1
                if event.get("type") in ("complete", "error"):
                    return
            if state["status"] in ("completed", "error") and sent >= len(events):
                return
            time.sleep(0.3)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Schedules
# ---------------------------------------------------------------------------

class ScheduleCreate(BaseModel):
    name: str
    cron: str
    brand_filter: str | None = None
    enabled: bool | None = True


class ScheduleUpdate(BaseModel):
    name: str | None = None
    cron: str | None = None
    brand_filter: str | None = None
    enabled: bool | None = None


@app.get("/api/schedules")
def list_schedules():
    if not DATABASE_URL:
        return []
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_schedules ORDER BY created_at DESC")
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            for key in ("last_run", "next_run", "created_at"):
                if row.get(key):
                    row[key] = row[key].isoformat()
            row["id"] = str(row["id"])
            row["cron_expression"] = row.pop("cron_expression", "")
            rows.append(row)
        return rows


@app.post("/api/schedules")
def create_schedule(req: ScheduleCreate):
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        schedule_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO cert_schedules (id, name, cron_expression, brand_filter, enabled)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            [schedule_id, req.name, req.cron, req.brand_filter, req.enabled],
        )
        row = dict(cur.fetchone())
        for key in ("last_run", "next_run", "created_at"):
            if row.get(key):
                row[key] = row[key].isoformat()
        row["id"] = str(row["id"])
        row["cron_expression"] = row.pop("cron_expression", "")
        return row


@app.put("/api/schedules/{schedule_id}")
def update_schedule(schedule_id: str, req: ScheduleUpdate):
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        updates = []
        params: list = []
        if req.name is not None:
            updates.append("name = %s")
            params.append(req.name)
        if req.cron is not None:
            updates.append("cron_expression = %s")
            params.append(req.cron)
        if req.brand_filter is not None:
            updates.append("brand_filter = %s")
            params.append(req.brand_filter if req.brand_filter else None)
        if req.enabled is not None:
            updates.append("enabled = %s")
            params.append(req.enabled)

        if not updates:
            raise HTTPException(400, "No fields to update")

        params.append(schedule_id)
        cur.execute(
            f"UPDATE cert_schedules SET {', '.join(updates)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Schedule not found")
        result = dict(row)
        for key in ("last_run", "next_run", "created_at"):
            if result.get(key):
                result[key] = result[key].isoformat()
        result["id"] = str(result["id"])
        result["cron_expression"] = result.pop("cron_expression", "")
        return result


@app.delete("/api/schedules/{schedule_id}")
def delete_schedule(schedule_id: str):
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        cur.execute("DELETE FROM cert_schedules WHERE id = %s", [schedule_id])
        if cur.rowcount == 0:
            raise HTTPException(404, "Schedule not found")
        return {"ok": True}


@app.post("/api/schedules/{schedule_id}/run")
def run_schedule_now(schedule_id: str):
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_schedules WHERE id = %s", [schedule_id])
        schedule = cur.fetchone()
        if not schedule:
            raise HTTPException(404, "Schedule not found")

        run_id = str(uuid.uuid4())
        brand = schedule["brand_filter"]
        cur.execute(
            "INSERT INTO cert_validation_runs (id, status, brand_filter) VALUES (%s, 'running', %s)",
            [run_id, brand],
        )
        now = datetime.now(timezone.utc)
        cur.execute("UPDATE cert_schedules SET last_run = %s WHERE id = %s", [now, schedule_id])

    _running_validations[run_id] = {"status": "running", "events": [], "processed": 0, "total": 0}
    thread = threading.Thread(target=_run_validation, args=(run_id, brand, None), daemon=True)
    thread.start()

    try:
        with db() as (conn, cur):
            cur.execute(
                "INSERT INTO cert_schedule_history (schedule_id, status) VALUES (%s, 'running')",
                [schedule_id],
            )
    except Exception:
        pass

    return {"run_id": run_id, "status": "running"}


@app.get("/api/schedules/{schedule_id}/history")
def get_schedule_history(schedule_id: str):
    if not DATABASE_URL:
        return []
    with db() as (conn, cur):
        cur.execute(
            """
            SELECT * FROM cert_schedule_history
            WHERE schedule_id = %s
            ORDER BY run_date DESC
            LIMIT 20
            """,
            [schedule_id],
        )
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            row["id"] = str(row["id"])
            row["schedule_id"] = str(row["schedule_id"])
            if row.get("run_date"):
                row["run_date"] = row["run_date"].isoformat()
            rows.append(row)
        return rows


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@app.get("/api/reports")
def list_reports():
    reports = []
    if not REPORTS_DIR.exists():
        return reports
    for f in sorted(REPORTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file():
            stat = f.stat()
            reports.append({
                "filename": f.name,
                "date": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "size_bytes": stat.st_size,
            })
    return reports


@app.get("/api/reports/{filename}/data")
def get_report_data(filename: str):
    filepath = REPORTS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(404, "Report not found")
    return json.loads(filepath.read_text())


@app.get("/api/reports/{filename}")
def download_report(filename: str):
    filepath = REPORTS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(404, "Report not found")
    media = "application/json" if filename.endswith(".json") else "application/octet-stream"
    return FileResponse(filepath, media_type=media, filename=filename)
