"""Health check routes."""

from contextlib import suppress
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter

from app.config import (
    CERTS_DIR,
    DATABASE_URL,
    REPORTS_DIR,
    SHEETS_CLIENT_EMAIL,
    SHEETS_PRIVATE_KEY,
    SHEETS_SPREADSHEET_ID,
    VTEX_STORES,
)
from app.db.postgres import db

router = APIRouter()


@router.get("/api/health")
def health() -> dict:
    """Basic liveness check.

    Returns:
        Dict with status, timestamp, database connectivity, and config flags.
    """
    result: dict = {"status": "ok", "timestamp": datetime.now(UTC).isoformat()}
    if DATABASE_URL:
        try:
            with db() as (conn, cur):
                cur.execute("SELECT 1")
            result["database"] = "connected"
        except Exception:
            result["database"] = "disconnected"
    result["sheets_configured"] = bool(SHEETS_CLIENT_EMAIL and SHEETS_PRIVATE_KEY and SHEETS_SPREADSHEET_ID)
    result["vtex_stores"] = list(VTEX_STORES.keys())
    return result


@router.get("/api/ready")
def ready() -> dict:
    """Readiness check — verifies DB and writable report storage.

    Returns:
        Dict with ready flag and details.
    """
    if not DATABASE_URL:
        return {"ready": False, "reason": "DATABASE_URL not configured"}
    try:
        with db() as (conn, cur):
            cur.execute("SELECT 1")
        for label, directory in (("REPORTS_DIR", REPORTS_DIR), ("CERTS_DIR", CERTS_DIR)):
            probe = directory / f".ready-{uuid4().hex}.tmp"
            try:
                probe.write_text("ok", encoding="utf-8")
            except PermissionError:
                return {"ready": False, "reason": f"{label} not writable"}
            finally:
                with suppress(Exception):
                    probe.unlink(missing_ok=True)
        return {"ready": True}
    except Exception as e:
        return {"ready": False, "reason": str(e)}
