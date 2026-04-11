"""Certification product routes."""

import json
import threading
import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import (
    DATABASE_URL,
    REPORTS_DIR,
    SHEETS_CLIENT_EMAIL,
    SHEETS_PRIVATE_KEY,
    VTEX_REQUEST_DELAY,
)
from app.db.postgres import db
from app.models.schemas import ValidateRequest, VerifyRequest
from app.services.cert_service import validate_single_product
from app.services.erp_service import sync_sheets_to_db
from app.utils.logging import log

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

# In-memory store for running validations
_running_validations: dict[str, dict] = {}


def get_running_validations() -> dict[str, dict]:
    """Expose the in-memory running validations dict.

    Returns:
        The shared _running_validations dict.
    """
    return _running_validations


def cleanup_old_validations(max_age_seconds: int = 3600, stuck_timeout: int = 7200) -> None:
    """Remove stale entries from the in-memory validation store.

    Args:
        max_age_seconds: Age in seconds after which completed/error runs are removed.
        stuck_timeout: Age in seconds after which 'running' runs are considered stuck.
    """
    now = time.time()
    to_remove = [
        rid
        for rid, state in _running_validations.items()
        if (
            state.get("status") in ("completed", "error")
            and now - state.get("_finished_at", now) > max_age_seconds
        )
        or (
            state.get("status") == "running"
            and now - state.get("_started_at", now) > stuck_timeout
        )
    ]
    for rid in to_remove:
        del _running_validations[rid]


def _serialize_product(r: dict) -> dict:
    for dtfield in ("last_validation_date", "created_at", "updated_at", "sale_deadline_date"):
        if r.get(dtfield):
            r[dtfield] = r[dtfield].isoformat() if hasattr(r[dtfield], "isoformat") else str(r[dtfield])
    return r


def _run_validation(
    run_id: str, brand_filter: str | None, limit: int | None, source: str | None = None
) -> None:
    """Background worker that validates each product against VTEX.

    Args:
        run_id: UUID string identifying this run.
        brand_filter: Optional brand to restrict validation to.
        limit: Optional max number of products to process.
        source: When 'sheets', syncs from Google Sheets before validating.
    """
    state = _running_validations[run_id]
    try:
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
                sql = (
                    f"SELECT sku, name, brand, certification_type, ecommerce_description, "
                    f"sheet_status, is_expired, sale_deadline_date FROM cert_products {where} ORDER BY sku"
                )
                if limit:
                    sql += f" LIMIT {int(limit)}"
                cur.execute(sql, params)
                products = [dict(r) for r in cur.fetchall()]

        state["total"] = len(products)
        ok = inconsistent = not_found = 0
        now = datetime.now(UTC)
        report_products = []

        for i, p in enumerate(products):
            sku = p["sku"]
            brand = p["brand"]
            expected_cert = p.get("certification_type", "") or ""
            ecommerce_desc = p.get("ecommerce_description", "") or ""
            p_is_expired = bool(p.get("is_expired", False))
            p_sale_deadline = str(p["sale_deadline_date"]) if p.get("sale_deadline_date") else ""

            vresult = validate_single_product(
                sku, brand, expected_cert,
                product_name=p.get("name", ""),
                ecommerce_description=ecommerce_desc,
                sheet_status=p.get("sheet_status", "") or "",
                is_expired=p_is_expired,
                sale_deadline_date=p_sale_deadline,
            )

            status = vresult["status"]
            score = vresult["score"]

            if status == "OK":
                ok += 1
            elif status == "INCONSISTENT":
                inconsistent += 1
            else:
                not_found += 1

            state["processed"] = i + 1
            state["events"].append({
                "type": "progress",
                "current": i + 1,
                "total": len(products),
                "product": {"sku": sku, "name": p["name"], "status": status, "score": score},
            })

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

            if DATABASE_URL:
                try:
                    with db() as (conn, cur):
                        cur.execute(
                            """
                            UPDATE cert_products
                            SET last_validation_status=%s, last_validation_score=%s,
                                last_validation_url=%s, last_validation_date=%s,
                                last_validation_error=%s, actual_cert_text=%s, updated_at=%s
                            WHERE sku=%s
                            """,
                            [status, score, vresult.get("url"), now,
                             vresult.get("error"), vresult.get("actual_cert_text"), now, sku],
                        )
                except Exception:
                    pass

            if i < len(products) - 1:
                time.sleep(VTEX_REQUEST_DELAY)

        summary = {
            "total": len(products),
            "ok": ok,
            "missing": 0,
            "inconsistent": inconsistent,
            "not_found": not_found,
        }

        report_filename = f"validation_{run_id[:8]}_{now.strftime('%Y%m%d_%H%M%S')}.json"
        report_path = REPORTS_DIR / report_filename
        report_path.write_text(
            json.dumps(
                {"run_id": run_id, "date": now.isoformat(), "summary": summary, "products": report_products},
                indent=2,
                ensure_ascii=False,
            )
        )

        if DATABASE_URL:
            try:
                with db() as (conn, cur):
                    cur.execute(
                        """
                        UPDATE cert_validation_runs
                        SET status='completed', total=%s, ok=%s, missing=0,
                            inconsistent=%s, not_found=%s, finished_at=%s, report_file=%s
                        WHERE id=%s
                        """,
                        [len(products), ok, inconsistent, not_found,
                         datetime.now(UTC), report_filename, run_id],
                    )
            except Exception:
                pass

        state["status"] = "completed"
        state["_finished_at"] = time.time()
        state["events"].append({"type": "complete", "summary": summary})

    except Exception as e:
        log.error(f"Validation run {run_id} failed: {e}", exc_info=True)
        state["status"] = "error"
        state["_finished_at"] = time.time()
        state["events"].append({"type": "error", "error": str(e)})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/api/sync-sheets")
@limiter.limit("5/minute")
def trigger_sync_sheets(request: Request) -> dict:
    """Trigger a manual sync from Google Sheets to cert_products.

    Returns:
        Sync result dict with 'synced' count.

    Raises:
        HTTPException: 400 if credentials not configured, 500 on sync error.
    """
    if not SHEETS_CLIENT_EMAIL or not SHEETS_PRIVATE_KEY:
        raise HTTPException(400, "Google Sheets credentials not configured")
    result = sync_sheets_to_db()
    if result.get("error"):
        raise HTTPException(500, result["error"])
    return result


@router.get("/api/stats")
def get_stats() -> dict:
    """Return aggregated certification stats.

    Returns:
        Dict with total_products, total_expired, last_run, by_brand.
    """
    if not DATABASE_URL:
        return {"total_products": 0, "total_expired": 0, "last_run": None, "by_brand": []}
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
                    "inconsistent": last_run_row["inconsistent"],
                    "not_found": (last_run_row.get("not_found") or 0) + (last_run_row.get("missing") or 0),
                }

            cur.execute("""
                SELECT brand,
                    COUNT(*) FILTER (WHERE last_validation_status = 'OK') as ok,
                    COUNT(*) FILTER (WHERE last_validation_status = 'INCONSISTENT') as inconsistent,
                    COUNT(*) FILTER (WHERE last_validation_status NOT IN ('OK','INCONSISTENT')
                        OR last_validation_status IS NULL) as not_found,
                    COUNT(*) FILTER (WHERE is_expired = TRUE) as expired
                FROM cert_products
                WHERE brand != ''
                GROUP BY brand
                ORDER BY brand
            """)
            by_brand = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT COUNT(*) as cnt FROM cert_products WHERE is_expired = TRUE")
            total_expired = cur.fetchone()["cnt"]

            return {
                "total_products": total,
                "total_expired": total_expired,
                "last_run": last_run,
                "by_brand": by_brand,
            }
    except Exception:
        return {"total_products": 0, "total_expired": 0, "last_run": None, "by_brand": []}


@router.get("/api/expired")
def list_expired_products(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: str = Query(""),
    brand: str = Query(""),
) -> dict:
    """List expired certification products.

    Args:
        page: Page number (1-based).
        per_page: Items per page (max 100).
        search: Optional search string for sku/name.
        brand: Optional brand filter.

    Returns:
        Paginated dict with products, total, page, per_page, total_pages.
    """
    if not DATABASE_URL:
        return {"products": [], "total": 0, "page": 1, "per_page": per_page, "total_pages": 0}

    with db() as (conn, cur):
        conditions = ["is_expired = TRUE"]
        params: list = []
        if search:
            conditions.append("(sku ILIKE %s OR name ILIKE %s)")
            params.extend([f"%{search}%", f"%{search}%"])
        if brand:
            conditions.append("LOWER(brand) = LOWER(%s)")
            params.append(brand)

        where = "WHERE " + " AND ".join(conditions)
        cur.execute(f"SELECT COUNT(*) as cnt FROM cert_products {where}", params)
        total = cur.fetchone()["cnt"]

        offset = (page - 1) * per_page
        cur.execute(
            f"SELECT * FROM cert_products {where} ORDER BY sale_deadline_date ASC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        rows = [_serialize_product(dict(r)) for r in cur.fetchall()]
        return {
            "products": rows,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": max(1, (total + per_page - 1) // per_page),
        }


@router.get("/api/products")
def list_products(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: str = Query(""),
    brand: str = Query(""),
    status: str = Query(""),
    start_date: str = Query(""),
    end_date: str = Query(""),
) -> dict:
    """List certification products with optional filters and stock enrichment.

    Returns:
        Paginated dict with products (enriched with stock), total, page, per_page,
        total_pages, last_validation_date.
    """
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
            if "EXPIRED" in statuses:
                statuses.remove("EXPIRED")
                if statuses:
                    conditions.append(
                        "(last_validation_status IN ({}) OR is_expired = TRUE)".format(
                            ",".join(["%s"] * len(statuses))
                        )
                    )
                    params.extend(statuses)
                else:
                    conditions.append("is_expired = TRUE")
            elif statuses:
                conditions.append(
                    "last_validation_status IN ({})".format(",".join(["%s"] * len(statuses)))
                )
                params.extend(statuses)

        if start_date:
            conditions.append("last_validation_date >= %s::date")
            params.append(start_date)
        if end_date:
            conditions.append("last_validation_date < (%s::date + interval '1 day')")
            params.append(end_date)

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        cur.execute(f"SELECT COUNT(*) as cnt FROM cert_products {where}", params)
        total = cur.fetchone()["cnt"]

        offset = (page - 1) * per_page
        cur.execute(
            f"SELECT * FROM cert_products {where} ORDER BY sku LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        products_raw = [_serialize_product(dict(r)) for r in cur.fetchall()]

        if products_raw:
            skus = [p["sku"] for p in products_raw]
            placeholders = ",".join(["%s"] * len(skus))
            cur.execute(
                f"""
                SELECT sku, source, warehouse,
                    COALESCE(SUM(quantity), 0) as qty,
                    COALESCE(SUM(available), 0) as avail
                FROM cert_stock WHERE sku IN ({placeholders})
                GROUP BY sku, source, warehouse
                """,
                skus,
            )
            stock_rows = cur.fetchall()
            stock_map: dict = {}
            for sr in stock_rows:
                sk = sr["sku"]
                if sk not in stock_map:
                    stock_map[sk] = {"stock_cd": 0, "stock_ecommerce": 0, "stock_total": 0, "stock_detail": []}
                entry = {"source": sr["source"], "warehouse": sr["warehouse"], "quantity": sr["qty"], "available": sr["avail"]}
                stock_map[sk]["stock_detail"].append(entry)
                if sr["source"] == "wms_biguacu":
                    stock_map[sk]["stock_cd"] += sr["avail"] or sr["qty"] or 0
                else:
                    stock_map[sk]["stock_ecommerce"] += sr["avail"] or sr["qty"] or 0
                stock_map[sk]["stock_total"] = stock_map[sk]["stock_cd"] + stock_map[sk]["stock_ecommerce"]

            for p in products_raw:
                s = stock_map.get(p["sku"], {})
                p["stock_cd"] = s.get("stock_cd", 0)
                p["stock_ecommerce"] = s.get("stock_ecommerce", 0)
                p["stock_total"] = s.get("stock_total", 0)
                p["stock_detail"] = s.get("stock_detail", [])

        cur.execute("SELECT MAX(last_validation_date) as last_date FROM cert_products")
        last_date_row = cur.fetchone()
        last_date = last_date_row["last_date"].isoformat() if last_date_row and last_date_row["last_date"] else None

        return {
            "products": products_raw,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": max(1, (total + per_page - 1) // per_page),
            "last_validation_date": last_date,
        }


@router.get("/api/products/{sku}")
def get_product(sku: str) -> dict:
    """Get a single product by SKU.

    Args:
        sku: Product SKU.

    Returns:
        Product dict with last_validation nested object.

    Raises:
        HTTPException: 404 if not found.
    """
    if not DATABASE_URL:
        raise HTTPException(404, "Product not found")

    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_products WHERE sku = %s", [sku])
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        result = _serialize_product(dict(row))

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


@router.post("/api/products/verify")
def verify_product(req: VerifyRequest) -> dict:
    """Verify a single product against VTEX in real time and save the result.

    Args:
        req: VerifyRequest with sku and brand.

    Returns:
        Validation result dict.
    """
    now = datetime.now(UTC)
    expected_cert = product_name = ecommerce_desc = sheet_status = sale_deadline_date_str = ""
    is_expired = False

    if DATABASE_URL:
        try:
            with db() as (conn, cur):
                cur.execute(
                    "SELECT certification_type, brand, name, ecommerce_description, sheet_status, is_expired, sale_deadline_date FROM cert_products WHERE sku = %s",
                    [req.sku],
                )
                row = cur.fetchone()
                if row:
                    expected_cert = row.get("certification_type", "") or ""
                    product_name = row.get("name", "") or ""
                    ecommerce_desc = row.get("ecommerce_description", "") or ""
                    sheet_status = row.get("sheet_status", "") or ""
                    is_expired = bool(row.get("is_expired", False))
                    sale_deadline_date_str = str(row["sale_deadline_date"]) if row.get("sale_deadline_date") else ""
        except Exception:
            pass

    result = validate_single_product(
        req.sku, req.brand, expected_cert,
        product_name=product_name, ecommerce_description=ecommerce_desc,
        sheet_status=sheet_status, is_expired=is_expired, sale_deadline_date=sale_deadline_date_str,
    )

    if DATABASE_URL:
        try:
            with db() as (conn, cur):
                cur.execute(
                    """
                    UPDATE cert_products
                    SET last_validation_status=%s, last_validation_score=%s,
                        last_validation_url=%s, last_validation_date=%s,
                        last_validation_error=%s, actual_cert_text=%s, updated_at=%s
                    WHERE sku=%s
                    """,
                    [result["status"], result["score"], result["url"],
                     now, result["error"], result.get("actual_cert_text"), now, req.sku],
                )
        except Exception as e:
            log.error(f"Failed to update product {req.sku}: {e}")

    return result


@router.post("/api/validate")
@limiter.limit("5/minute")
def start_validation(request: Request, req: ValidateRequest) -> dict:
    """Start a background batch validation run.

    Args:
        req: ValidateRequest with optional brand, limit, source filters.

    Returns:
        Dict with run_id and status='running'.
    """
    run_id = str(uuid.uuid4())

    if DATABASE_URL:
        with db() as (conn, cur):
            cur.execute(
                "INSERT INTO cert_validation_runs (id, status, brand_filter) VALUES (%s, 'running', %s)",
                [run_id, req.brand],
            )

    cleanup_old_validations()
    _running_validations[run_id] = {
        "status": "running", "events": [], "processed": 0, "total": 0, "_started_at": time.time()
    }
    thread = threading.Thread(
        target=_run_validation, args=(run_id, req.brand, req.limit, req.source), daemon=True
    )
    thread.start()

    return {"run_id": run_id, "status": "running"}


@router.get("/api/validate/{run_id}")
def get_validation_status(run_id: str) -> dict:
    """Get the status of a validation run.

    Args:
        run_id: UUID of the validation run.

    Returns:
        Dict with run_id, status, processed, total.

    Raises:
        HTTPException: 404 if not found.
    """
    state = _running_validations.get(run_id)
    if state:
        return {"run_id": run_id, "status": state["status"], "processed": state["processed"], "total": state["total"]}

    if DATABASE_URL:
        with db() as (conn, cur):
            cur.execute("SELECT * FROM cert_validation_runs WHERE id = %s", [run_id])
            row = cur.fetchone()
            if row:
                return {"run_id": run_id, "status": row["status"], "processed": row["total"], "total": row["total"]}

    raise HTTPException(404, "Validation run not found")


@router.get("/api/validate/{run_id}/stream")
def stream_validation(run_id: str) -> StreamingResponse:
    """Server-Sent Events stream for validation progress.

    Args:
        run_id: UUID of the validation run.

    Returns:
        StreamingResponse with SSE events.

    Raises:
        HTTPException: 404 if run not found.
    """
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
