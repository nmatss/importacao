"""Cert-API FastAPI application entry point."""

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import CORS_ORIGINS, DATABASE_URL, SHEETS_CLIENT_EMAIL, SHEETS_PRIVATE_KEY
from app.routes import certifications, health, reports, schedules, stock
from app.routes.schedules import load_schedules_into_scheduler, scheduler
from app.utils.auth import verify_api_key
from app.utils.logging import log

app = FastAPI(
    title="Cert-API",
    version="2.0.0",
    dependencies=[Depends(verify_api_key)],
)

app.state.limiter = certifications.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization"],
)

app.include_router(health.router)
app.include_router(certifications.router)
app.include_router(schedules.router)
app.include_router(stock.router)
app.include_router(reports.router)


@app.on_event("startup")
def startup() -> None:
    """Initialize DB tables, sync sheets, and start APScheduler on app startup."""
    if DATABASE_URL:
        from app.db.postgres import ensure_tables
        try:
            ensure_tables()
        except Exception as e:
            log.warning(f"Could not create tables: {e}")

    if SHEETS_CLIENT_EMAIL and SHEETS_PRIVATE_KEY:
        from app.services.erp_service import sync_licenciados_to_db, sync_sheets_to_db
        try:
            log.info(f"Startup sheets sync: {sync_sheets_to_db()}")
        except Exception as e:
            log.warning(f"Startup sheets sync failed: {e}")
        try:
            log.info(f"Startup licenciados sync: {sync_licenciados_to_db()}")
        except Exception as e:
            log.warning(f"Startup licenciados sync failed: {e}")

    try:
        scheduler.start()
        load_schedules_into_scheduler()
        log.info("APScheduler started successfully")
    except Exception as e:
        log.warning(f"Failed to start scheduler: {e}")


@app.on_event("shutdown")
def shutdown() -> None:
    """Shutdown APScheduler and close DB pool on app shutdown."""
    try:
        scheduler.shutdown(wait=False)
    except Exception:
        pass
    from app.db.postgres import close_pool
    close_pool()
