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
