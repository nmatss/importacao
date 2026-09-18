"""Shared product filter semantics for pagination and full Excel exports."""

import re
from datetime import date

from app.services.erp_service import normalize_brand_filter

SEARCH_SQL = "(sku ILIKE %s OR name ILIKE %s OR COALESCE(numero_certificado, '') ILIKE %s)"


def product_filter_sql(
    *,
    search: str = "",
    brand: str = "",
    grife: str = "",
    status: str = "",
    start_date: str = "",
    end_date: str = "",
    license_start_date: str = "",
    license_end_date: str = "",
) -> tuple[str, list]:
    """Bound SQL predicates. License dates are inclusive and exclude sentinels.

    Existing start_date/end_date concern validation timestamps, independently
    from the license interval. Invalid license input raises ValueError.
    """
    license_dates = []
    for value in (license_start_date, license_end_date):
        if not value:
            license_dates.append(None)
            continue
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Periodo de licenciamento deve usar datas ISO YYYY-MM-DD")
        try:
            license_dates.append(date.fromisoformat(value))
        except ValueError:
            raise ValueError("Data de licenciamento invalida") from None
    if all(license_dates) and license_dates[0] > license_dates[1]:
        raise ValueError("Inicio do periodo de licenciamento deve ser anterior ou igual ao fim")

    conditions: list[str] = []
    params: list = []
    if search:
        conditions.append(SEARCH_SQL)
        params.extend([f"%{search}%"] * 3)
    if brand:
        conditions.append("LOWER(REPLACE(brand, '_', ' ')) = %s")
        params.append(normalize_brand_filter(brand))
    if grife:
        conditions.append("LOWER(COALESCE(grife, '')) = LOWER(%s)")
        params.append(grife.strip())
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if "EXPIRED" in statuses:
            statuses.remove("EXPIRED")
            if statuses:
                conditions.append(
                    "(last_validation_status IN ({}) OR is_expired = TRUE)".format(",".join(["%s"] * len(statuses)))
                )
                params.extend(statuses)
            else:
                conditions.append("is_expired = TRUE")
        elif statuses:
            conditions.append("last_validation_status IN ({})".format(",".join(["%s"] * len(statuses))))
            params.extend(statuses)
    if start_date:
        conditions.append("last_validation_date >= %s::date")
        params.append(start_date)
    if end_date:
        conditions.append("last_validation_date < (%s::date + interval '1 day')")
        params.append(end_date)
    if license_start_date or license_end_date:
        conditions.append("linx_fim_licenciamento >= DATE '2000-01-01'")
    if license_start_date:
        conditions.append("linx_fim_licenciamento >= %s::date")
        params.append(license_start_date)
    if license_end_date:
        conditions.append("linx_fim_licenciamento <= %s::date")
        params.append(license_end_date)
    return ("WHERE " + " AND ".join(conditions) if conditions else "", params)


def parse_csv_filter(raw: str) -> set[str]:
    """Parse a comma-separated, case-insensitive filter value into a set.

    Empty / blank input means "no constraint" (returns an empty set).
    """
    return {part.strip().lower() for part in (raw or "").split(",") if part.strip()}


def matches_derived_filters(
    product: dict,
    cert_statuses: set[str],
    site_statuses: set[str],
    license_statuses: set[str],
    comercializacao_statuses: set[str] | None = None,
) -> bool:
    """Return True when a serialized product matches all requested derived axes.

    Filtering is case-insensitive, AND across axes; an empty axis imposes no
    constraint. The derived fields (cert_status/site_status/license_status/
    comercializacao_status) come from `compute_status_dimensions`, so this must
    run AFTER serialization.
    """
    if cert_statuses and str(product.get("cert_status") or "").strip().lower() not in cert_statuses:
        return False
    if site_statuses and str(product.get("site_status") or "").strip().lower() not in site_statuses:
        return False
    if license_statuses and str(product.get("license_status") or "").strip().lower() not in license_statuses:
        return False
    return not (
        comercializacao_statuses
        and str(product.get("comercializacao_status") or "").strip().lower() not in comercializacao_statuses
    )
