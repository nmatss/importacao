"""Opt-in PostgreSQL integration, exclusively in an owned ephemeral container.

Run with CERT_RUN_POSTGRES_TESTS=1. Requires Docker and an already available
postgres:16-alpine image. Never consumes DATABASE_URL or an existing database.
"""

import os
import subprocess
import time
import uuid
from datetime import date
from unittest.mock import MagicMock

import psycopg2
import pytest
from psycopg2.pool import ThreadedConnectionPool

from app.db import postgres, release_migrations
from app.services import erp_service
from app.services.derivation import compute_status_dimensions

pytestmark = pytest.mark.skipif(
    os.environ.get("CERT_RUN_POSTGRES_TESTS") != "1",
    reason="Opt-in: CERT_RUN_POSTGRES_TESTS=1 and ephemeral Docker PostgreSQL required",
)


def _docker(*args):
    return subprocess.run(
        ["docker", *args],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    ).stdout.strip()


@pytest.fixture
def isolated_postgres(monkeypatch):
    name = f"cert-provenance-test-{uuid.uuid4().hex}"
    container_id = None
    pool = None
    try:
        container_id = _docker(
            "run",
            "--detach",
            "--rm",
            "--pull=never",
            "--name",
            name,
            "--tmpfs",
            "/var/lib/postgresql/data:rw",
            "--publish",
            "127.0.0.1::5432",
            "--env",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            "--env",
            "POSTGRES_DB=cert_provenance_test",
            "postgres:16-alpine",
        )
        binding = _docker("port", container_id, "5432/tcp")
        assert binding.startswith("127.0.0.1:") and "\n" not in binding
        port = int(binding.rsplit(":", 1)[1])
        dsn = f"host=127.0.0.1 port={port} user=postgres dbname=cert_provenance_test connect_timeout=1"
        deadline = time.monotonic() + 30
        while True:
            try:
                pool = ThreadedConnectionPool(1, 4, dsn)
                break
            except psycopg2.OperationalError:
                if time.monotonic() >= deadline:
                    pytest.fail("Owned ephemeral PostgreSQL did not become ready within 30 seconds")
                time.sleep(0.2)

        # Replace the pool accessor, preserving any application pool untouched.
        monkeypatch.setattr(postgres, "_get_pool", lambda: pool)
        monkeypatch.setattr("app.config.DATABASE_URL", dsn)
        yield postgres
    finally:
        if pool is not None:
            pool.closeall()
        if container_id is not None:
            # Only the exact ID returned by our own docker run is removable.
            _docker("rm", "--force", container_id)


def _product(sku, certificate):
    return {
        "sku": sku,
        "name": "Synthetic product",
        "brand": "Imaginarium",
        "certification_type": "INMETRO",
        "numero_certificado": certificate,
        "situacao": "Ativo",
        "sheet_status": "S",
        "ecommerce_description": "Synthetic certification description",
        "validade_certificado": date(2030, 1, 1),
        "validade_certificado_raw": "01/01/2030",
    }


def _ending(sku, certificate, status):
    return {
        "sku": sku,
        "name": "Synthetic ending",
        "brand": "Imaginarium",
        "numero_certificado": certificate,
        "sale_deadline": "01/01/2020",
        "sale_deadline_date": "2020-01-01",
        "encerramento_status": status,
        "is_expired": True,
    }


def _rows(database):
    with database.db() as (_conn, cur):
        cur.execute("SELECT * FROM cert_products ORDER BY sku")
        return {row["sku"]: dict(row) for row in cur.fetchall()}


def test_cadastro_read_model_preserves_sheet_snapshot_and_resolves_links(isolated_postgres):
    from app.services.effective_products import execute_product_query

    database = isolated_postgres
    database.ensure_tables()
    release_migrations.apply_release_migrations()
    with database.db() as (_conn, cur):
        cur.execute("""
            INSERT INTO cert_products (sku, brand, numero_certificado, situacao, sheet_status, sale_deadline_date)
            VALUES ('SAME', 'Imaginarium', 'C1', 'Ativo', 'Original sheet history', '2020-01-01'),
                   ('CONFLICT', 'Imaginarium', 'OLD', 'Ativo', 'Original source', NULL),
                   ('NEW', 'Imaginarium', NULL, NULL, '__cadastro_snapshot__', NULL)
        """)
        certificates = {}
        for sku, number in [('SAME', 'C1'), ('NEW', 'C2'), ('CONFLICT', 'C3'), ('LEGACY', 'C4')]:
            cur.execute("""
                INSERT INTO cert_certificates (sku, brand, numero_certificado, situacao, validade_certificado)
                VALUES (%s, 'imaginarium', %s, 'ATIVO', '2030-01-01') RETURNING id
            """, [sku, number])
            certificates[sku] = cur.fetchone()['id']
            if sku != 'LEGACY':
                cur.execute("INSERT INTO cert_certificate_items (certificate_id, sku, brand) VALUES (%s, %s, 'imaginarium')",
                            [certificates[sku], sku])

    def effective():
        with database.db() as (_conn, cur):
            execute_product_query(cur, "SELECT * FROM cert_products ORDER BY sku")
            return {row['sku']: dict(row) for row in cur.fetchall()}

    rows = effective()
    assert set(rows) == {'SAME', 'NEW', 'CONFLICT', 'LEGACY'}
    assert rows['NEW']['numero_certificado'] == 'C2'
    assert rows['LEGACY']['numero_certificado'] == 'C4'
    assert rows['SAME']['sale_deadline_date'] is None
    assert rows['SAME']['validade_certificado'] == date(2030, 1, 1)
    assert rows['CONFLICT']['numero_certificado'] == 'OLD'
    assert compute_status_dimensions(rows['CONFLICT'])['cert_status'] == 'PENDENTE'
    assert 'C3' in rows['CONFLICT']['sheet_status']
    assert _rows(database)['SAME']['sale_deadline_date'] == date(2020, 1, 1)
    assert _rows(database)['CONFLICT']['sheet_status'] == 'Original source'

    with database.db() as (_conn, cur):
        # An individual closure does not close the parent certificate.
        cur.execute("UPDATE cert_certificate_items SET situacao='ENCERRADO', fim_venda='2027-12-31' WHERE sku='SAME'")
    assert effective()['SAME']['sale_deadline_date'] == date(2027, 12, 31)
    assert effective()['SAME']['situacao'] == 'ENCERRADO'
    with database.db() as (_conn, cur):
        # Reverting/unlinking exposes the intact original. A removed item must
        # never reappear through the parent's legacy SKU fallback.
        cur.execute("UPDATE cert_certificate_items SET removed_at=NOW() WHERE sku IN ('SAME','NEW')")
    rows = effective()
    assert rows['SAME']['sheet_status'] == 'Original sheet history'
    assert 'NEW' not in rows

    with database.db() as (_conn, cur):
        execute_product_query(cur, "SELECT COUNT(*) AS cnt FROM cert_products WHERE numero_certificado = %s", ['C4'])
        assert cur.fetchone()['cnt'] == 1


@pytest.mark.asyncio
async def test_registration_to_product_restriction_and_unlink_http_cycle(
    isolated_postgres, test_client, api_key_headers, monkeypatch, tmp_path
):
    from app.routes import certificates, certifications

    database = isolated_postgres
    database.ensure_tables()
    release_migrations.apply_release_migrations()
    monkeypatch.setattr(certificates, 'DATABASE_URL', 'isolated-test')
    monkeypatch.setattr(certifications, 'DATABASE_URL', 'isolated-test')
    monkeypatch.setattr(certifications, '_safe_license_map', lambda: {})
    writer = MagicMock(return_value={'status': 'disabled', 'produto_codigo': None, 'error': 'test', 'details': []})
    monkeypatch.setattr(certificates, 'write_certificate_to_linx', writer)
    response = await test_client.post('/api/certificates', headers=api_key_headers, data={
        'sku': 'HTTP-NEW', 'brand': 'imaginarium', 'numero_certificado': '12345/2026',
        'validade_certificado': '2030-01-01', 'situacao': 'ATIVO', 'orgao_certificador': 'INMETRO',
    })
    assert response.status_code == 200, response.text
    cert_id = response.json()['id']
    response = await test_client.get('/api/products?search=12345%2F2026', headers=api_key_headers)
    assert response.status_code == 200, response.text
    rows = response.json()['products']
    assert len(rows) == 1
    assert rows[0]['sku'] == 'HTTP-NEW'
    assert rows[0]['numero_certificado'] == '12345/2026'
    assert rows[0]['cert_status'] == 'ATIVO'
    assert rows[0]['sale_deadline_date'] is None
    writer.reset_mock()
    response = await test_client.patch(
        f'/api/certificates/{cert_id}/items/HTTP-NEW/restriction', headers=api_key_headers,
        json={'situacao': 'ENCERRADO', 'fim_venda': '2028-01-01', 'motivo': 'Synthetic item closure'},
    )
    assert response.status_code == 200, response.text
    response = await test_client.get('/api/products/HTTP-NEW', headers=api_key_headers)
    assert response.status_code == 200, response.text
    product = response.json()
    assert product['cert_status'] == 'ENCERRADO'
    assert product['sale_deadline_date'] == '2028-01-01'
    with database.db() as (_conn, cur):
        cur.execute("UPDATE cert_products SET numero_certificado='OTHER-SOURCE', sheet_status='Preserved sheet' WHERE sku='HTTP-NEW'")
    response = await test_client.get('/api/products?cert_status=PENDENTE', headers=api_key_headers)
    assert response.status_code == 200, response.text
    products = response.json()['products']
    assert len(products) == 1
    assert products[0]['numero_certificado'] == 'OTHER-SOURCE'
    assert products[0]['cert_status'] == 'PENDENTE'
    assert '12345/2026' in products[0]['cert_status_reason']
    # The exported workbook uses the exact same effective row and preserves
    # its existing columns; no ERP/site calls occur in this fixture.
    import openpyxl

    from app.services import report_service
    monkeypatch.setattr(report_service, 'REPORTS_DIR', tmp_path)
    monkeypatch.setattr(report_service, '_fetch_stock_map', lambda: {})
    monkeypatch.setattr(report_service, '_fetch_travas_faturamento', lambda rows: {})
    report = report_service.generate_products_report(products, today=date(2026, 9, 18))
    workbook = openpyxl.load_workbook(report)
    report_row = next(row for row in workbook.active.iter_rows(values_only=True) if row[0] == 'HTTP-NEW')
    assert report_row[3] == 'Pendente de validacao'
    assert report_row[8] == 'OTHER-SOURCE'
    assert '12345/2026' in report_row[5]
    workbook.close()
    response = await test_client.delete(f'/api/certificates/{cert_id}/items/HTTP-NEW', headers=api_key_headers)
    assert response.status_code == 200, response.text
    response = await test_client.get('/api/products?search=HTTP-NEW', headers=api_key_headers)
    assert response.json()['total'] == 1
    assert response.json()['products'][0]['numero_certificado'] == 'OTHER-SOURCE'
    writer.assert_not_called()


def test_migration_sync_derivation_cleanup_and_legacy_projection(isolated_postgres, monkeypatch):
    database = isolated_postgres
    database.ensure_tables()
    with database.db() as (_conn, cur):
        # Snapshot predates the new column; migration must not invent provenance.
        cur.execute("""
            INSERT INTO cert_products
                (sku, name, numero_certificado, situacao, sale_deadline,
                 sale_deadline_date, encerramento_status, is_expired)
            VALUES ('LEGACY', 'Synthetic legacy', 'LEGACY-CERT', 'Ativo',
                    '01/01/2020', '2020-01-01', 'Comerciação Permitida', TRUE)
        """)
    before = _rows(database)["LEGACY"]
    release_migrations.apply_release_migrations()
    release_migrations.apply_release_migrations()
    after = _rows(database)["LEGACY"]
    assert after["encerramento_numero_certificado"] is None
    assert {key: after[key] for key in before} == before
    with database.db() as (_conn, cur):
        cur.execute("""
            SELECT data_type, is_nullable, column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cert_products'
              AND column_name = 'encerramento_numero_certificado'
        """)
        assert dict(cur.fetchone()) == {"data_type": "text", "is_nullable": "YES", "column_default": None}

    products = [_product("SAME-PERMITTED", "C-1"), _product("SAME-EMPTY", "C-2"), _product("NEW", "C-NEW")]
    endings = [
        _ending("SAME-PERMITTED", " c-1 ", "Comerciação Permitida"),
        _ending("SAME-EMPTY", "C-2", ""),
        _ending("NEW", "C-OLD", "Vencido - Venda Bloqueada"),
    ]
    monkeypatch.setattr(erp_service, "_get_sheets_client", lambda: MagicMock())
    monkeypatch.setattr(erp_service, "SHEETS_SPREADSHEET_ID", "synthetic-sheet")
    monkeypatch.setattr(erp_service, "_read_ativos_from_sheets", lambda *a, **kw: products)
    monkeypatch.setattr(erp_service, "_read_encerramentos_from_sheets", lambda *a, **kw: endings)
    result = erp_service.sync_sheets_to_db()
    assert "error" not in result
    assert result["encerramentos"] == 2
    assert result["skus_dupla_certificacao"] == 1
    with database.db() as (_conn, cur):
        cur.execute("UPDATE cert_products SET last_validation_status = 'OK'")
    rows = _rows(database)
    for product in products:
        row = rows[product["sku"]]
        for field in ("name", "brand", "numero_certificado", "situacao", "validade_certificado"):
            assert row[field] == product[field]
    for ending in endings[:2]:
        row = rows[ending["sku"]]
        assert row["encerramento_numero_certificado"] == ending["numero_certificado"]
        assert row["encerramento_status"] == (ending["encerramento_status"] or None)
        assert row["sale_deadline_date"] == date(2020, 1, 1)
        dimensions = compute_status_dimensions(row, today=date(2026, 9, 18))
        assert dimensions["cert_status"] == "ATIVO"
        assert dimensions["status_venda"] == "BLOQUEADA"
        assert dimensions["site_status"] == "NAO_CONFORME"
    assert rows["NEW"]["encerramento_numero_certificado"] is None
    assert rows["NEW"]["sale_deadline_date"] is None
    assert compute_status_dimensions(rows["NEW"], today=date(2026, 9, 18))["status_venda"] == "LIBERADA"
    assert compute_status_dimensions(rows["NEW"], today=date(2026, 9, 18))["site_status"] == "CONFORME"

    # A later SQL error must roll back both the product and ending upserts.
    original_name = products[0]["name"]
    original_deadline = endings[0]["sale_deadline_date"]
    products[0]["name"] = "Synthetic change that must roll back"
    endings[0]["sale_deadline_date"] = "invalid-date"
    try:
        assert "error" in erp_service.sync_sheets_to_db()
        assert _rows(database) == rows
    finally:
        products[0]["name"] = original_name
        endings[0]["sale_deadline_date"] = original_deadline

    # A successful nonempty read permits cleanup of removed endings.
    with database.db() as (_conn, cur):
        cur.execute("""
            INSERT INTO cert_products (sku, encerramento_numero_certificado)
            VALUES ('ONLY-PROVENANCE', 'RESIDUAL-CERT')
        """)
    endings[:] = [_ending("SENTINEL", "SENTINEL-CERT", "Vencido - Venda Bloqueada")]
    assert "error" not in erp_service.sync_sheets_to_db()
    rows = _rows(database)
    for sku in ("SAME-PERMITTED", "SAME-EMPTY", "ONLY-PROVENANCE"):
        assert all(
            rows[sku][field] is None
            for field in (
                "sale_deadline",
                "sale_deadline_date",
                "encerramento_status",
                "encerramento_numero_certificado",
            )
        )
        assert rows[sku]["is_expired"] is False

    # Additive DDL allows code rollback: a pre-migration projection still works.
    with database.db() as (_conn, cur):
        cur.execute(
            "SELECT sku, numero_certificado, situacao, sale_deadline_date FROM cert_products WHERE sku = %s", ["NEW"]
        )
        assert dict(cur.fetchone()) == {
            "sku": "NEW",
            "numero_certificado": "C-NEW",
            "situacao": "Ativo",
            "sale_deadline_date": None,
        }


def test_reader_preserves_identified_ending_without_deadline_in_database(isolated_postgres, monkeypatch):
    database = isolated_postgres
    release_migrations.apply_release_migrations()
    spreadsheet = MagicMock()
    spreadsheet.worksheet.return_value.get_all_values.return_value = [
        ["CERTIFICADO", "SKU", "PRAZO FINAL VENDA", "STATUS", "MARCA", "NOME"],
        ["C-1", "NO-DEADLINE", "", "", "Imaginarium", "Synthetic"],
        ["C-OTHER", "OTHER", "01/01/2020", "Vencido - Venda Bloqueada", "Imaginarium", "Other"],
    ]
    client = MagicMock()
    client.open_by_key.return_value = spreadsheet
    monkeypatch.setattr(erp_service, "_get_sheets_client", lambda: client)
    monkeypatch.setattr(erp_service, "SHEETS_SPREADSHEET_ID", "synthetic-sheet")
    monkeypatch.setattr(erp_service, "_read_ativos_from_sheets", lambda *a, **kw: [_product("NO-DEADLINE", "C-1")])
    result = erp_service.sync_sheets_to_db()
    assert "error" not in result
    assert result["encerramentos"] == 2
    assert result["pendencias_total"] == 1
    row = _rows(database)["NO-DEADLINE"]
    assert row["numero_certificado"] == row["encerramento_numero_certificado"] == "C-1"
    assert row["sale_deadline_date"] is None
    assert row["encerramento_status"] is None
    status = compute_status_dimensions(row, today=date(2026, 9, 18))
    assert status["cert_status"] == "ATIVO"
    assert status["status_venda"] == "BLOQUEADA"
    assert status["comercializacao_status"] == "PENDENTE"
