"""Pydantic request/response models."""

from apscheduler.triggers.cron import CronTrigger
from pydantic import BaseModel

CRON_VALIDATION_ERROR = (
    "Expressao cron invalida. Use 5 campos: minuto hora dia mes dia_semana "
    "(ex: 0 8 * * 1-5)."
)


def normalize_cron_expression(cron: str) -> str:
    """Validate and normalize a five-field cron expression for APScheduler."""
    normalized = " ".join(cron.strip().split())
    if not normalized:
        raise ValueError("Expressao cron e obrigatoria")
    if len(normalized.split()) != 5:
        raise ValueError(CRON_VALIDATION_ERROR)
    try:
        CronTrigger.from_crontab(normalized, timezone="America/Sao_Paulo")
    except ValueError as exc:
        raise ValueError(CRON_VALIDATION_ERROR) from exc
    return normalized


class VerifyRequest(BaseModel):
    """Request body for single-product verification."""

    sku: str
    brand: str


class ValidateRequest(BaseModel):
    """Request body for batch validation run."""

    brand: str | None = None
    limit: int | None = None
    source: str | None = None


class ScheduleCreate(BaseModel):
    """Request body for creating a schedule."""

    name: str
    cron: str
    brand_filter: str | None = None
    enabled: bool | None = True


class ScheduleUpdate(BaseModel):
    """Request body for updating a schedule."""

    name: str | None = None
    cron: str | None = None
    brand_filter: str | None = None
    enabled: bool | None = None
