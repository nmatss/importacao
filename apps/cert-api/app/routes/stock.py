"""Stock and licenciados routes."""

from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import DATABASE_URL, SHEETS_CLIENT_EMAIL, SHEETS_PRIVATE_KEY
from app.db.postgres import db, ensure_li_tracking_table
from app.services.erp_service import sync_licenciados_to_db
from app.services.wms_service import sync_stock_all

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/api/sync-stock")
@limiter.limit("5/minute")
def sync_stock(request: Request) -> dict:
    """Sync stock from WMS Oracle + ERP SQL Server into cert_stock.

    Returns:
        Dict with wms, ecommerce_puket, ecommerce_imaginarium counts and errors list.

    Raises:
        HTTPException: 500 if DATABASE_URL not configured.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    return sync_stock_all()


@router.get("/api/stock/{sku}")
def get_stock_by_sku(sku: str) -> dict:
    """Get stock data for a specific SKU across all sources.

    Args:
        sku: Product SKU to look up.

    Returns:
        Dict with sku, stock list, total_quantity, total_available.

    Raises:
        HTTPException: 500 if DATABASE_URL not configured.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")

    with db() as (conn, cur):
        cur.execute(
            "SELECT source, warehouse, quantity, available, reserved, in_transit, synced_at FROM cert_stock WHERE sku = %s",
            (sku,),
        )
        rows = [dict(r) for r in cur.fetchall()]

    result: dict = {"sku": sku, "stock": [], "total_quantity": 0, "total_available": 0}
    for item in rows:
        if item.get("synced_at") and hasattr(item["synced_at"], "isoformat"):
            item["synced_at"] = item["synced_at"].isoformat()
        result["stock"].append(item)
        result["total_quantity"] += item.get("quantity", 0) or 0
        result["total_available"] += item.get("available", 0) or 0
    return result


@router.post("/api/sync-licenciados")
@limiter.limit("5/minute")
def trigger_sync_licenciados(request: Request) -> dict:
    """Trigger a manual sync of Licenciados from Google Sheets.

    Returns:
        Sync result dict.

    Raises:
        HTTPException: 400 if credentials missing, 500 on error.
    """
    if not SHEETS_CLIENT_EMAIL or not SHEETS_PRIVATE_KEY:
        raise HTTPException(400, "Google Sheets credentials not configured")
    result = sync_licenciados_to_db()
    if result.get("error"):
        raise HTTPException(500, result["error"])
    return result


@router.get("/api/licenciados")
def list_licenciados(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: str = Query(""),
    status: str = Query(""),
    start_date: str = Query(""),
    end_date: str = Query(""),
) -> dict:
    """List licenciado tracking items with filters.

    Returns:
        Paginated dict with items, total, page, per_page, total_pages.
    """
    if not DATABASE_URL:
        return {"items": [], "total": 0, "page": 1, "per_page": per_page, "total_pages": 0}

    ensure_li_tracking_table()

    with db() as (conn, cur):
        conditions: list[str] = []
        params: list = []

        if search:
            conditions.append("(process_code ILIKE %s OR ncm ILIKE %s OR description ILIKE %s)")
            params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
        if status:
            conditions.append("status = %s")
            params.append(status)
        if start_date:
            conditions.append("created_at >= %s::date")
            params.append(start_date)
        if end_date:
            conditions.append("created_at < (%s::date + interval '1 day')")
            params.append(end_date)

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        cur.execute(f"SELECT COUNT(*) as cnt FROM li_tracking {where}", params)
        total = cur.fetchone()["cnt"]

        offset = (page - 1) * per_page
        cur.execute(
            f"SELECT * FROM li_tracking {where} ORDER BY updated_at DESC NULLS LAST LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            for dtfield in ("created_at", "updated_at", "valid_until"):
                if row.get(dtfield):
                    row[dtfield] = row[dtfield].isoformat() if hasattr(row[dtfield], "isoformat") else str(row[dtfield])
            rows.append(row)

        return {
            "items": rows,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": max(1, (total + per_page - 1) // per_page),
        }


@router.get("/api/licenciados/{process_code}")
def get_licenciado_detail(process_code: str) -> dict:
    """Get all licenciado entries for a specific process code.

    Args:
        process_code: Import process code.

    Returns:
        Dict with process_code, items list, total count.

    Raises:
        HTTPException: 404 if no entries found.
    """
    if not DATABASE_URL:
        raise HTTPException(404, "Not found")

    ensure_li_tracking_table()

    with db() as (conn, cur):
        cur.execute("SELECT * FROM li_tracking WHERE process_code = %s ORDER BY ncm", [process_code])
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            for dtfield in ("created_at", "updated_at", "valid_until"):
                if row.get(dtfield):
                    row[dtfield] = row[dtfield].isoformat() if hasattr(row[dtfield], "isoformat") else str(row[dtfield])
            rows.append(row)

        if not rows:
            raise HTTPException(404, f"No licenciado entries found for process '{process_code}'")
        return {"process_code": process_code, "items": rows, "total": len(rows)}
