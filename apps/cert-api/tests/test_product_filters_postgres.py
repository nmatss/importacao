"""Opt-in real PostgreSQL checks for inclusive license filters and export parity."""

import os
from datetime import date

import pytest

from app.db.release_migrations import apply_release_migrations
from tests.test_encerramento_provenance_postgres import isolated_postgres as isolated_postgres

pytestmark = pytest.mark.skipif(
    os.environ.get("CERT_RUN_POSTGRES_TESTS") != "1",
    reason="Opt-in ephemeral PostgreSQL: CERT_RUN_POSTGRES_TESTS=1",
)


async def test_license_boundaries_and_all_filters_match_export(
    isolated_postgres,
    test_client,
    api_key_headers,
    mocker,
    tmp_path,
):
    from app.routes import certifications, reports

    apply_release_migrations()
    mocker.patch("app.services.derivation._today_sp", return_value=date(2026, 9, 18))
    mocker.patch.object(certifications, "DATABASE_URL", "isolated")
    mocker.patch.object(reports, "DATABASE_URL", "isolated")
    mocker.patch.object(reports.limiter, "enabled", False)
    mocker.patch.object(certifications, "_safe_license_map", return_value={})
    mocker.patch.object(reports, "safe_license_map", return_value={})
    mocker.patch.object(reports, "snapshot_sync_warning", return_value=None)
    output = tmp_path / "synthetic.xlsx"
    output.write_bytes(b"synthetic export fixture")
    generate = mocker.patch.object(reports, "generate_products_report", return_value=output)
    cases = [
        ("START", "2026-01-01", "2025-01-01", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("END", "2026-01-31", "2025-01-31 23:59:59", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("BEFORE", "2025-12-31", "2025-01-01", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("AFTER", "2026-02-01", "2025-01-01", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("TODAY", "2026-09-18", "2025-01-01", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("SENTINEL", "1900-01-01", "2025-01-01", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("NULL", None, "2025-01-01", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("OLD", "1999-12-31", "2025-01-01", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("BRAND", "2026-01-15", "2025-01-01", "Imaginarium", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("GRIFE", "2026-01-15", "2025-01-01", "Puket", "MINIONS", "OK", "Ativo", "SYNTHETIC"),
        ("STATUS", "2026-01-15", "2025-01-01", "Puket", "SNOOPY", "INCONSISTENT", "Ativo", "SYNTHETIC"),
        ("VALIDATION", "2026-01-15", "2026-01-01", "Puket", "SNOOPY", "OK", "Ativo", "SYNTHETIC"),
        ("CERT", "2026-01-15", "2025-01-01", "Puket", "SNOOPY", "OK", "Encerrado", "SYNTHETIC"),
        ("SEARCH", "2026-01-15", "2025-01-01", "Puket", "SNOOPY", "OK", "Ativo", "OTHER"),
    ]
    with isolated_postgres.db() as (_conn, cur):
        for sku, license_date, validation_date, brand, grife, status, situation, name in cases:
            cur.execute(
                """
                INSERT INTO cert_products
                    (sku, name, brand, grife, linx_fim_licenciamento, last_validation_date,
                     last_validation_status, situacao, numero_certificado, linx_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'CERT', NOW())
            """,
                [sku, name, brand, grife, license_date, validation_date, status, situation],
            )

    async def compare(params, expected, paginate=False):
        response = await test_client.get(
            "/api/products", params={**params, "per_page": 1 if paginate else 100}, headers=api_key_headers
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["total"] == len(expected)
        listed = {row["sku"] for row in data["products"]}
        if paginate:
            for page in range(2, data["total_pages"] + 1):
                response = await test_client.get(
                    "/api/products", params={**params, "page": page, "per_page": 1}, headers=api_key_headers
                )
                assert response.status_code == 200
                listed.update(row["sku"] for row in response.json()["products"])
        assert listed == expected
        exported = await test_client.post("/api/reports/export", params=params, headers=api_key_headers)
        assert exported.status_code == 200, exported.text
        assert {row["sku"] for row in generate.call_args.args[0]} == expected

    # No license interval preserves existing inclusion of unknown/sentinel dates.
    await compare({}, {case[0] for case in cases})
    await compare({"license_end_date": "1999-12-31"}, set())
    await compare({"license_start_date": "2026-02-01"}, {"AFTER", "TODAY"})
    await compare({"license_end_date": "2025-12-31"}, {"BEFORE"})
    await compare(
        {"license_start_date": "2026-09-18", "license_end_date": "2026-09-18", "license_status": "valido"}, {"TODAY"}
    )
    await compare(
        {
            "search": "SYNTHETIC",
            "brand": "puket",
            "grife": "snoopy",
            "status": "OK",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "license_start_date": "2026-01-01",
            "license_end_date": "2026-01-31",
            "cert_status": "ativo",
            "site_status": "nao_conforme",
            "license_status": "vencido",
            "comercializacao_status": "encerrada",
        },
        {"START", "END"},
        paginate=True,
    )
