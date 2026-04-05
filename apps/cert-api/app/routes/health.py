"""Health check routes."""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import DATABASE_URL, VTEX_STORES
from app.db.postgres import db

router = APIRouter()


@router.get("/api/health")
def health() -> dict:
    """Basic liveness check.

    Returns:
        Dict with status, timestamp, database connectivity, and config flags.
    """
    result: dict = {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
    if DATABASE_URL:
        try:
            with db() as (conn, cur):
                cur.execute("SELECT 1")
            result["database"] = "connected"
        except Exception:
            result["database"] = "disconnected"
    result["sheets_configured"] = bool(DATABASE_URL)
    result["vtex_stores"] = list(VTEX_STORES.keys())
    return result


@router.get("/api/ready")
def ready() -> dict:
    """Readiness check — verifies DB is reachable.

    Returns:
        Dict with ready flag and details.
    """
    if not DATABASE_URL:
        return {"ready": False, "reason": "DATABASE_URL not configured"}
    try:
        with db() as (conn, cur):
            cur.execute("SELECT 1")
        return {"ready": True}
    except Exception as e:
        return {"ready": False, "reason": str(e)}
