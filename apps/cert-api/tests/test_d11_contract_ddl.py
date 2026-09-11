"""DDL do contrato de dados da certificacao (reuniao 2026-09-11, decisao D11).

`ensure_tables()` roda a cada startup contra bases que ja existem em producao,
entao cada instrucao nova precisa ser idempotente e aditiva. Estes testes fixam
as instrucoes emitidas — o que o startup de fato manda ao Postgres — e nao so a
existencia das funcoes no modulo.
"""

import re
from contextlib import contextmanager

import pytest

from app.db import postgres


def _norm(sql: str) -> str:
    return " ".join(sql.split())


@pytest.fixture
def ddl(mocker) -> dict:
    """Roda `ensure_tables()` com um banco falso e devolve tudo o que foi emitido."""
    state: dict = {"statements": [], "columns": []}

    @contextmanager
    def fake_db():
        cur = mocker.MagicMock()
        cur.execute.side_effect = lambda sql, *a: state["statements"].append(_norm(sql))
        cur.fetchone.return_value = None
        yield (mocker.MagicMock(), cur)

    mocker.patch.object(postgres, "db", fake_db)
    mocker.patch.object(
        postgres,
        "_add_column_if_not_exists",
        side_effect=lambda col, coltype, table="cert_products": state["columns"].append(
            (table, col, coltype)
        ),
    )

    postgres.ensure_tables()
    return state


def _create(statements: list[str], table: str) -> str:
    found = [s for s in statements if f"CREATE TABLE IF NOT EXISTS {table} " in s]
    assert len(found) == 1, f"{table}: esperado 1 CREATE TABLE, veio {len(found)}"
    return found[0]


@pytest.mark.parametrize(
    "col,tipo",
    [
        ("validade_certificado", "DATE"),
        ("validade_certificado_raw", "TEXT"),
        ("status_venda", "TEXT CHECK (status_venda IN ('LIBERADA', 'BLOQUEADA'))"),
        ("trava_venda", "DATE"),
        ("trava_origem", "TEXT CHECK (trava_origem IN ('certificacao', 'licenciamento'))"),
        ("linx_fim_licenciamento", "DATE"),
        ("linx_prop_certificacao", "DATE"),
        ("linx_fim_vendas", "DATE"),
        ("grife", "TEXT"),
        ("linx_synced_at", "TIMESTAMPTZ"),
    ],
)
def test_cert_products_ganha_as_colunas_d11(ddl, col, tipo):
    assert ("cert_products", col, tipo) in ddl["columns"]


def test_cert_certificates_ganha_fim_venda_e_situacao(ddl):
    assert ("cert_certificates", "fim_venda", "DATE") in ddl["columns"]
    situacao = [c for c in ddl["columns"] if c[:2] == ("cert_certificates", "situacao")]
    assert len(situacao) == 1
    assert "DEFAULT 'ATIVO'" in situacao[0][2]
    assert "CHECK (situacao IN ('ATIVO', 'ENCERRADO'))" in situacao[0][2]


def test_base_nova_cria_cert_certificates_com_sku_anulavel(ddl):
    create = _create(ddl["statements"], "cert_certificates")
    assert re.search(r"\bsku TEXT,", create)
    assert "sku TEXT NOT NULL" not in create


def test_cert_certificate_items(ddl):
    create = _create(ddl["statements"], "cert_certificate_items")
    for trecho in (
        "certificate_id UUID NOT NULL REFERENCES cert_certificates(id) ON DELETE RESTRICT",
        "sku TEXT NOT NULL",
        "brand TEXT",
        "produto_codigo TEXT",
        "linx_status TEXT NOT NULL DEFAULT 'pending'",
        "linx_error TEXT",
        "linx_detail JSONB",
        "linx_applied_at TIMESTAMPTZ",
        "added_by TEXT",
        "added_at TIMESTAMPTZ",
        "removed_by TEXT",
        "removed_at TIMESTAMPTZ",
    ):
        assert trecho in create, trecho
    assert (
        "CREATE UNIQUE INDEX IF NOT EXISTS cert_certificate_items_active_uniq "
        "ON cert_certificate_items(certificate_id, sku) WHERE removed_at IS NULL"
    ) in ddl["statements"]
    assert (
        "CREATE INDEX IF NOT EXISTS cert_certificate_items_sku_idx ON cert_certificate_items(sku)"
    ) in ddl["statements"]


def test_items_sao_criados_depois_de_cert_certificates(ddl):
    """A FK exige a tabela referenciada antes."""
    stmts = ddl["statements"]
    i_cert = next(i for i, s in enumerate(stmts) if "EXISTS cert_certificates " in s)
    i_items = next(i for i, s in enumerate(stmts) if "EXISTS cert_certificate_items " in s)
    assert i_cert < i_items


def test_cert_sync_runs(ddl):
    create = _create(ddl["statements"], "cert_sync_runs")
    for trecho in (
        "started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "finished_at TIMESTAMPTZ",
        "CHECK (trigger IN ('manual', 'startup', 'schedule', 'hourly'))",
        "actor TEXT",
        "result JSONB",
        "error TEXT",
    ):
        assert trecho in create, trecho


def test_cert_marketplace_items(ddl):
    create = _create(ddl["statements"], "cert_marketplace_items")
    for trecho in (
        "vtex_product_id TEXT NOT NULL",
        "seller_id TEXT",
        "seller_name TEXT",
        "name TEXT",
        "url TEXT",
        "pieces INTEGER",
        "cert_text TEXT",
        "CHECK (verdict IN ('OK', 'NAO_OK', 'REVISAR', 'NAO_EXIGE'))",
        "reason TEXT",
        "checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "run_id TEXT",
    ):
        assert trecho in create, trecho


def test_toda_instrucao_de_ddl_e_idempotente(ddl):
    """O startup reaplica tudo; CREATE sem IF NOT EXISTS quebraria o 2o boot."""
    for s in ddl["statements"]:
        if s.startswith("CREATE"):
            assert "IF NOT EXISTS" in s, s
    for table, col, _ in ddl["columns"]:
        # O helper sempre emite ADD COLUMN IF NOT EXISTS — ver o teste abaixo.
        assert table in {"cert_products", "cert_certificates"}, (table, col)


def test_helper_emite_add_column_if_not_exists_na_tabela_certa(mocker):
    cur = mocker.MagicMock()
    conn = mocker.MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    mocker.patch.object(postgres, "get_conn", return_value=conn)
    mocker.patch.object(postgres, "_get_pool")

    postgres._add_column_if_not_exists("fim_venda", "DATE", table="cert_certificates")

    cur.execute.assert_called_once_with(
        "ALTER TABLE cert_certificates ADD COLUMN IF NOT EXISTS fim_venda DATE"
    )
    conn.commit.assert_called_once()


def test_helper_mantem_cert_products_como_padrao(mocker):
    cur = mocker.MagicMock()
    conn = mocker.MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    mocker.patch.object(postgres, "get_conn", return_value=conn)
    mocker.patch.object(postgres, "_get_pool")

    postgres._add_column_if_not_exists("grife", "TEXT")

    cur.execute.assert_called_once_with("ALTER TABLE cert_products ADD COLUMN IF NOT EXISTS grife TEXT")


def test_falha_do_helper_deixa_aviso_e_nao_derruba(mocker):
    conn = mocker.MagicMock()
    conn.cursor.return_value.__enter__.return_value.execute.side_effect = RuntimeError("lock")
    mocker.patch.object(postgres, "get_conn", return_value=conn)
    mocker.patch.object(postgres, "_get_pool")
    warn = mocker.patch.object(postgres.log, "warning")

    postgres._add_column_if_not_exists("grife", "TEXT")  # nao levanta

    assert warn.called
    conn.rollback.assert_called_once()


def test_ensure_tables_roda_a_migracao_de_cert_certificates(mocker):
    @contextmanager
    def fake_db():
        yield (mocker.MagicMock(), mocker.MagicMock())

    mocker.patch.object(postgres, "db", fake_db)
    mocker.patch.object(postgres, "_add_column_if_not_exists")
    mocker.patch.object(postgres, "_migrate_stock_synced_at_to_timestamptz")
    migrate = mocker.patch.object(postgres, "_migrate_cert_certificates_d11")

    postgres.ensure_tables()

    migrate.assert_called_once()


def _run_d11_migration(mocker, fail_on: str | None = None) -> list[str]:
    emitted: list[str] = []

    @contextmanager
    def fake_db():
        cur = mocker.MagicMock()

        def execute(sql, *a):
            n = _norm(sql)
            if fail_on and fail_on in n:
                raise RuntimeError("could not create unique index")
            emitted.append(n)

        cur.execute.side_effect = execute
        yield (mocker.MagicMock(), cur)

    mocker.patch.object(postgres, "db", fake_db)
    postgres._migrate_cert_certificates_d11()
    return emitted


def test_migracao_torna_sku_anulavel_e_cria_unico_parcial(mocker):
    emitted = _run_d11_migration(mocker)

    assert "ALTER TABLE cert_certificates ALTER COLUMN sku DROP NOT NULL" in emitted
    assert (
        "CREATE UNIQUE INDEX IF NOT EXISTS cert_certificates_brand_numero_uniq "
        "ON cert_certificates(brand, numero_certificado) WHERE numero_certificado IS NOT NULL"
    ) in emitted


def test_duplicata_legada_nao_derruba_o_startup(mocker):
    """Base antiga com numero repetido: o indice falha, o aviso fica, o sku ainda muda."""
    warn = mocker.patch.object(postgres.log, "warning")

    emitted = _run_d11_migration(mocker, fail_on="cert_certificates_brand_numero_uniq")

    assert "ALTER TABLE cert_certificates ALTER COLUMN sku DROP NOT NULL" in emitted
    assert warn.called
