"""Report download and generation routes."""

import json
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import DATABASE_URL, REPORTS_DIR
from app.db.postgres import db
from app.services.report_service import (
    generate_products_report,
    generate_stock_report,
    generate_validation_report_xlsx,
)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/api/reports/export")
@limiter.limit("10/minute")
def export_products_report(
    request: Request, brand: str = Query(""), status: str = Query("")
) -> FileResponse:
    """Generate and download an Excel report for cert_products.

    Args:
        brand: Optional brand filter.
        status: Optional comma-separated status filter.

    Returns:
        FileResponse with the generated .xlsx file.

    Raises:
        HTTPException: 500 if database not configured.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")

    with db() as (conn, cur):
        conditions: list[str] = []
        params: list = []
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

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        cur.execute(f"SELECT * FROM cert_products {where} ORDER BY brand, sku", params)
        rows = [dict(r) for r in cur.fetchall()]

    filepath = generate_products_report(rows, brand=brand, status=status)
    return FileResponse(
        str(filepath),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filepath.name,
    )


@router.post("/api/reports/export-stock")
@limiter.limit("5/minute")
def export_stock_report(request: Request, brand: str = Query("")) -> FileResponse:
    """Generate and download a detailed stock Excel report.

    Args:
        brand: Optional brand filter.

    Returns:
        FileResponse with the generated .xlsx file.

    Raises:
        HTTPException: 500 if database not configured.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")

    with db() as (conn, cur):
        conditions = []
        params: list = []
        if brand:
            conditions.append("cs.brand = %s")
            params.append(brand)

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        cur.execute(
            f"""
            SELECT cs.sku, cp.name, COALESCE(cp.brand, cs.brand) as brand,
                cs.source, cs.warehouse, cs.quantity, cs.available,
                cs.reserved, cs.in_transit, cs.situation, cs.storage_area,
                cp.last_validation_status, cp.sale_deadline, cp.is_expired,
                cs.synced_at
            FROM cert_stock cs
            LEFT JOIN cert_products cp ON cs.sku = cp.sku
            {where}
            ORDER BY cs.sku, cs.source, cs.warehouse
            """,
            params,
        )
        rows = cur.fetchall()

    filepath = generate_stock_report(rows, brand=brand)
    return FileResponse(
        str(filepath),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filepath.name,
    )


@router.get("/api/reports")
def list_reports() -> list:
    """List all report files in REPORTS_DIR.

    Returns:
        List of dicts with filename, date, size_bytes.
    """
    if not REPORTS_DIR.exists():
        return []
    reports = []
    for f in sorted(REPORTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file():
            stat = f.stat()
            reports.append({
                "filename": f.name,
                "date": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
                "size_bytes": stat.st_size,
            })
    return reports


@router.get("/api/reports/{filename}/data")
def get_report_data(filename: str) -> dict:
    """Return the raw JSON data from a JSON report file.

    Args:
        filename: Basename of the report file.

    Returns:
        Parsed JSON dict.

    Raises:
        HTTPException: 400 on path traversal attempt, 404 if not found.
    """
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    filepath = REPORTS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(404, "Report not found")
    return json.loads(filepath.read_text())


@router.get("/api/reports/{filename}")
def download_report(filename: str, format: str = Query("xlsx")) -> FileResponse:
    """Download or convert a report file.

    If format='json' and the file is not .xlsx, returns it as JSON.
    If the file is already .xlsx, serves it directly.
    Otherwise converts a .json report to .xlsx.

    Args:
        filename: Basename of the report file.
        format: 'xlsx' (default) or 'json'.

    Returns:
        FileResponse.

    Raises:
        HTTPException: 400 on bad input, 404 if not found.
    """
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    filepath = REPORTS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(404, "Report not found")

    if format == "json":
        if filename.endswith(".xlsx"):
            raise HTTPException(400, "Este arquivo e binario (xlsx), nao pode ser baixado como JSON")
        return FileResponse(filepath, media_type="application/json", filename=filename)

    if filename.endswith(".xlsx"):
        return FileResponse(
            str(filepath),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=filename,
        )

    # Convert JSON report to xlsx
    excel_path = generate_validation_report_xlsx(filename)
    return FileResponse(
        str(excel_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=excel_path.name,
    )
