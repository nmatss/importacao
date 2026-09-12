"""Pydantic request/response models."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.utils.cron import build_cron_trigger

CRON_VALIDATION_ERROR = (
    "Expressao cron invalida. Use 5 campos: minuto hora dia mes dia_semana "
    "(ex: 0 8 * * 1-5)."
)


def normalize_cron_expression(cron: str) -> str:
    """Validate and normalize a five-field cron expression.

    A expressao e guardada e devolvida na convencao CRONTAB (0 = domingo), que e
    a que a interface exibe. A validacao usa `build_cron_trigger`, o mesmo
    caminho que monta o job — assim o que passa na criacao e exatamente o que o
    scheduler consegue disparar, inclusive `7` como domingo.
    """
    normalized = " ".join(cron.strip().split())
    if not normalized:
        raise ValueError("Expressao cron e obrigatoria")
    if len(normalized.split()) != 5:
        raise ValueError(CRON_VALIDATION_ERROR)
    try:
        build_cron_trigger(normalized)
    except (ValueError, TypeError) as exc:
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


class CertificateItemsRequest(BaseModel):
    """Vinculo em massa de SKUs a um certificado (decisao D11).

    `dry_run` e o padrao: a tela mostra a previa (o que seria vinculado, o que ja
    esta, o que pertence a outro certificado ativo) ANTES de qualquer gravacao
    no Linx. Confirmar exige mandar `dry_run=false` explicitamente.
    """

    skus: list[str] = []
    dry_run: bool = True


class CertificateItemRestrictionRequest(BaseModel):
    """Overrides explicitos; null herda o certificado, nunca presume dispensa."""

    situacao: Literal["ATIVO", "ENCERRADO"] | None
    fim_venda: date | None
    motivo: str = Field(min_length=1, max_length=1000)


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
