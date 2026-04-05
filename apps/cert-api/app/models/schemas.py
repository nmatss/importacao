"""Pydantic request/response models."""

from pydantic import BaseModel


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
