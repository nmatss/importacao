"""Shared listing/export filter contracts and invalid input behavior."""

import pytest

from app.services.product_filters import product_filter_sql


@pytest.mark.parametrize(
    "params",
    [
        {"license_start_date": "2026-02-30"},
        {"license_end_date": "31/01/2026"},
        {"license_start_date": "20260101"},
        {"license_end_date": "2026-01-01T00:00:00"},
        {"license_start_date": "2026-02-01", "license_end_date": "2026-01-31"},
    ],
)
@pytest.mark.parametrize("endpoint", ["/api/products", "/api/reports/export"])
async def test_invalid_license_range_is_client_error_before_database(
    test_client,
    api_key_headers,
    mocker,
    params,
    endpoint,
):
    from app.routes import reports

    mocker.patch.object(reports.limiter, "enabled", False)
    db = mocker.patch("app.routes.certifications.db")
    report_db = mocker.patch("app.routes.reports.db")
    request = test_client.get if endpoint == "/api/products" else test_client.post
    response = await request(endpoint, params=params, headers=api_key_headers)
    assert response.status_code == 400
    db.assert_not_called()
    report_db.assert_not_called()


def test_license_period_is_independent_from_validation_period_and_binds_values():
    sql, params = product_filter_sql(
        search="SYNTHETIC",
        brand="puket_escolares",
        grife="SNOOPY",
        status="OK,EXPIRED",
        start_date="2025-01-01",
        end_date="2025-01-31",
        license_start_date="2026-01-01",
        license_end_date="2026-01-31",
    )
    assert "linx_fim_licenciamento >= DATE '2000-01-01'" in sql
    assert "linx_fim_licenciamento >= %s::date" in sql
    assert "linx_fim_licenciamento <= %s::date" in sql
    assert "last_validation_date >= %s::date" in sql
    assert "last_validation_date < (%s::date + interval '1 day')" in sql
    assert params == [
        "%SYNTHETIC%",
        "%SYNTHETIC%",
        "%SYNTHETIC%",
        "puket escolares",
        "SNOOPY",
        "OK",
        "2025-01-01",
        "2025-01-31",
        "2026-01-01",
        "2026-01-31",
    ]
    assert "SYNTHETIC" not in sql and "2026-01-31" not in sql
