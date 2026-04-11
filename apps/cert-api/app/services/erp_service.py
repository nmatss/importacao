"""Google Sheets sync services for certifications and licenciados."""

import re
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials

from app.config import SHEETS_CLIENT_EMAIL, SHEETS_PRIVATE_KEY, SHEETS_SPREADSHEET_ID
from app.db.postgres import db
from app.utils.logging import log


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


def _find_col_by_header(headers: list[str], *candidates: str) -> int | None:
    """Find a column index by matching header text (case-insensitive).

    Args:
        headers: List of header strings from the first row.
        *candidates: Substrings to search for in headers.

    Returns:
        Zero-based column index, or None if not found.
    """
    for i, h in enumerate(headers):
        h_lower = h.lower().strip()
        for c in candidates:
            if c.lower() in h_lower:
                return i
    return None


def _read_products_from_sheets() -> list[dict]:
    """Read product certification data from Google Sheets (Ativos + Encerramentos tabs).

    Returns Encerramentos products first, then Ativos — so the upsert logic lets Ativos
    data overwrite Encerramentos for any SKU that appears in both.

    Returns:
        List of product dicts ready for upsert into cert_products.
    """
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

        if not rows:
            continue

        headers = rows[0]
        desc_ecommerce_col = _find_col_by_header(
            headers,
            "descrição e-commerce", "descricao e-commerce",
            "descrição ecommerce", "descricao ecommerce",
            "desc e-commerce", "desc ecommerce",
        )
        if desc_ecommerce_col is not None:
            log.info(
                f"Worksheet '{cfg['name']}': found 'Descrição E-commerce' at column {desc_ecommerce_col}"
            )

        for row in rows[1:]:
            sku_col = cfg["sku_col"]
            if sku_col >= len(row):
                continue
            raw_sku = str(row[sku_col]).strip()
            if not raw_sku:
                continue

            name = str(row[cfg["name_col"]]).strip() if cfg["name_col"] < len(row) else ""
            if cfg["brand_col"] is not None and cfg["brand_col"] < len(row):
                brand = str(row[cfg["brand_col"]]).strip() or cfg["brand_default"]
            else:
                brand = cfg["brand_default"]
            cert_type = str(row[cfg["cert_type_col"]]).strip() if cfg["cert_type_col"] < len(row) else ""
            sheet_status = str(row[cfg["status_col"]]).strip() if cfg["status_col"] < len(row) else ""
            desc_ecommerce = ""
            if desc_ecommerce_col is not None and desc_ecommerce_col < len(row):
                desc_ecommerce = str(row[desc_ecommerce_col]).strip()

            for sku in re.split(r"[\r\n]+", raw_sku):
                sku = sku.strip()
                if not sku:
                    continue
                products.append({
                    "sku": sku,
                    "name": name,
                    "brand": brand,
                    "certification_type": cert_type,
                    "sheet_status": sheet_status,
                    "ecommerce_description": desc_ecommerce,
                    "_source": "ativos",
                })

    log.info(f"Read {len(products)} active products from Google Sheets")

    # Read Encerramentos tab
    enc_products: list[dict] = []
    try:
        ws_enc = spreadsheet.worksheet("Encerramentos")
        enc_rows = ws_enc.get_all_values()
        if enc_rows:
            enc_headers = enc_rows[0]
            prazo_col = _find_col_by_header(enc_headers, "prazo final venda", "prazo final", "prazo venda")
            sku_col_enc = _find_col_by_header(enc_headers, "sku", "código", "codigo", "ref")
            name_col_enc = _find_col_by_header(enc_headers, "nome", "produto", "descrição", "descricao")
            brand_col_enc = _find_col_by_header(enc_headers, "marca", "brand")
            status_col_enc = _find_col_by_header(enc_headers, "status", "situação", "situacao")

            if prazo_col is not None and sku_col_enc is not None:
                today = datetime.now().date()
                expired_count = 0
                venda_fim_lote_count = 0

                for row in enc_rows[1:]:
                    if sku_col_enc >= len(row):
                        continue
                    raw_sku = str(row[sku_col_enc]).strip()
                    if not raw_sku:
                        continue
                    prazo_str = str(row[prazo_col]).strip() if prazo_col < len(row) else ""
                    if not prazo_str:
                        continue

                    enc_status_str = (
                        str(row[status_col_enc]).strip()
                        if status_col_enc is not None and status_col_enc < len(row)
                        else ""
                    )
                    combined_text = f"{prazo_str} {enc_status_str}".lower()
                    is_venda_fim_lote = (
                        "venda até fim do lote" in combined_text
                        or "venda ate fim do lote" in combined_text
                    )
                    is_vencido = "vencido" in combined_text

                    prazo_date = None
                    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
                        try:
                            prazo_date = datetime.strptime(prazo_str, fmt).date()
                            break
                        except ValueError:
                            continue

                    if is_venda_fim_lote:
                        is_expired = False
                        venda_fim_lote_count += 1
                        sheet_status_val = "VENDA_FIM_LOTE"
                    elif is_vencido:
                        is_expired = True
                        sheet_status_val = "EXPIRED"
                    elif prazo_date is not None:
                        is_expired = prazo_date < today
                        sheet_status_val = "EXPIRED" if is_expired else "EXPIRING"
                    else:
                        continue

                    name = (
                        str(row[name_col_enc]).strip()
                        if name_col_enc is not None and name_col_enc < len(row)
                        else ""
                    )
                    brand = (
                        str(row[brand_col_enc]).strip()
                        if brand_col_enc is not None and brand_col_enc < len(row)
                        else ""
                    )

                    for sku in re.split(r"[\r\n]+", raw_sku):
                        sku = sku.strip()
                        if not sku:
                            continue
                        enc_products.append({
                            "sku": sku,
                            "name": name,
                            "brand": brand,
                            "certification_type": f"ENCERRAMENTO - Prazo: {prazo_str}",
                            "sheet_status": sheet_status_val,
                            "ecommerce_description": "",
                            "sale_deadline": prazo_str,
                            "sale_deadline_date": prazo_date.isoformat() if prazo_date else None,
                            "is_expired": is_expired,
                            "_source": "encerramentos",
                        })
                        if is_expired:
                            expired_count += 1

                log.info(
                    f"Encerramentos: {expired_count} expired, {venda_fim_lote_count} 'venda fim lote'"
                )
            else:
                log.warning(
                    f"Worksheet 'Encerramentos': missing required columns (prazo={prazo_col}, sku={sku_col_enc})"
                )
    except gspread.exceptions.WorksheetNotFound:
        log.info("Worksheet 'Encerramentos' not found, skipping expiration check")
    except Exception as e:
        log.warning(f"Error reading 'Encerramentos' worksheet: {e}")

    # Encerramentos first, Ativos second — upsert lets Ativos win on conflict
    return enc_products + products


def sync_sheets_to_db() -> dict:
    """Sync certification products from Google Sheets into cert_products table.

    Returns:
        Dict with 'synced' count and optional 'error' key.
    """
    from app.config import DATABASE_URL

    products = _read_products_from_sheets()
    if not products:
        return {"synced": 0, "error": "No products found or Sheets not configured"}
    if not DATABASE_URL:
        return {"synced": 0, "error": "Database not configured"}

    try:
        with db() as (conn, cur):
            for p in products:
                ecommerce_desc = p.get("ecommerce_description", "")
                expected = ecommerce_desc if ecommerce_desc else p["certification_type"]
                sale_deadline = p.get("sale_deadline")
                sale_deadline_date = p.get("sale_deadline_date")
                source = p.get("_source", "ativos")
                is_expired = False if source == "ativos" else p.get("is_expired", False)

                cur.execute(
                    """
                    INSERT INTO cert_products
                        (sku, name, brand, certification_type, expected_cert_text,
                         ecommerce_description, sheet_status, sale_deadline,
                         sale_deadline_date, is_expired, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (sku) DO UPDATE SET
                        name = COALESCE(NULLIF(EXCLUDED.name, ''), cert_products.name),
                        brand = COALESCE(NULLIF(EXCLUDED.brand, ''), cert_products.brand),
                        certification_type = CASE WHEN EXCLUDED.sale_deadline IS NOT NULL
                            THEN EXCLUDED.certification_type
                            ELSE COALESCE(NULLIF(EXCLUDED.certification_type, ''), cert_products.certification_type)
                        END,
                        expected_cert_text = COALESCE(NULLIF(EXCLUDED.expected_cert_text, ''), cert_products.expected_cert_text),
                        ecommerce_description = COALESCE(NULLIF(EXCLUDED.ecommerce_description, ''), cert_products.ecommerce_description),
                        sheet_status = CASE WHEN EXCLUDED.sale_deadline IS NOT NULL
                            THEN EXCLUDED.sheet_status
                            ELSE COALESCE(NULLIF(EXCLUDED.sheet_status, ''), cert_products.sheet_status)
                        END,
                        sale_deadline = COALESCE(EXCLUDED.sale_deadline, cert_products.sale_deadline),
                        sale_deadline_date = COALESCE(EXCLUDED.sale_deadline_date, cert_products.sale_deadline_date),
                        is_expired = EXCLUDED.is_expired,
                        updated_at = NOW()
                    """,
                    [
                        p["sku"], p["name"], p["brand"], p["certification_type"],
                        expected, ecommerce_desc, p["sheet_status"],
                        sale_deadline, sale_deadline_date, is_expired,
                    ],
                )
        return {"synced": len(products), "total_rows": len(products)}
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
