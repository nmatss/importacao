"""Cert-API FastAPI application entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import (
    CORS_ORIGINS,
    DATABASE_URL,
    SHEETS_CLIENT_EMAIL,
    SHEETS_PRIVATE_KEY,
    validate_linx_config,
)
from app.routes import (
    certificates,
    certifications,
    health,
    marketplace,
    reports,
    schedules,
    stock,
)
from app.routes.schedules import (
    load_schedules_into_scheduler,
    schedule_hourly_sheet_sync,
    scheduler,
)
from app.utils.auth import verify_api_key
from app.utils.logging import log


def run_startup() -> None:
    """Initialize DB tables, sync sheets, and start APScheduler on app startup."""
    # Fail-fast: nao servir requests com escrita no Linx ligada e config parcial.
    validate_linx_config()

    if DATABASE_URL:
        from app.db.postgres import verify_item_restriction_schema
        # All release DDL runs through the explicit migration CLI, never boot.
        verify_item_restriction_schema()

    if SHEETS_CLIENT_EMAIL and SHEETS_PRIVATE_KEY:
        from app.services.sync_runs import run_sheet_sync
        try:
            # Mesmo caminho do botao manual e do job horario: um lock so e uma
            # linha em cert_sync_runs, para que "quando a planilha foi lida pela
            # ultima vez" tenha resposta inclusive apos um restart.
            log.info(f"Startup sheets sync: {run_sheet_sync('startup')}")
        except Exception as e:
            log.warning(f"Startup sheets sync failed: {e}")

    try:
        scheduler.start()
        load_schedules_into_scheduler()
        schedule_hourly_sheet_sync()
        log.info("APScheduler started successfully")
    except Exception as e:
        log.warning(f"Failed to start scheduler: {e}")


def run_shutdown() -> None:
    """Shutdown APScheduler and close DB pool on app shutdown."""
    try:
        scheduler.shutdown(wait=False)
    except Exception:
        pass
    from app.db.postgres import close_pool
    close_pool()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """FastAPI lifespan hook replacing deprecated startup/shutdown events."""
    run_startup()
    try:
        yield
    finally:
        run_shutdown()


app = FastAPI(
    title="Cert-API",
    version="2.0.0",
    dependencies=[Depends(verify_api_key)],
    lifespan=lifespan,
)

app.state.limiter = certifications.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    # DELETE entrou com a remocao individual de item do certificado (D11); sem
    # ele o preflight do navegador barra a lixeira da tela de cadastro.
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization"],
)

app.include_router(health.router)
app.include_router(certifications.router)
app.include_router(certificates.router)
app.include_router(schedules.router)
app.include_router(stock.router)
app.include_router(reports.router)
app.include_router(marketplace.router)
