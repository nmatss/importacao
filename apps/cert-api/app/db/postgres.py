"""PostgreSQL connection pool and context manager."""

import threading
from collections.abc import Generator
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool

from app.config import DATABASE_URL
from app.utils.logging import log

_pool: pg_pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> pg_pool.ThreadedConnectionPool:
    """Return the shared connection pool, creating it if necessary.

    Returns:
        The active ThreadedConnectionPool.
    """
    global _pool
    if _pool is None or _pool.closed:
        with _pool_lock:
            if _pool is None or _pool.closed:
                _pool = pg_pool.ThreadedConnectionPool(1, 10, DATABASE_URL)
    return _pool


def get_conn() -> psycopg2.extensions.connection:
    """Borrow a connection from the pool.

    Returns:
        A psycopg2 connection.
    """
    return _get_pool().getconn()


@contextmanager
def db() -> Generator[tuple[psycopg2.extensions.connection, psycopg2.extras.RealDictCursor], None, None]:
    """Context manager that yields (conn, cursor) and handles commit/rollback/return.

    Yields:
        Tuple of (connection, RealDictCursor).

    Raises:
        Exception: Re-raises any exception after rolling back the transaction.
    """
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _get_pool().putconn(conn)


def put_conn(conn: psycopg2.extensions.connection, *, close: bool = False) -> None:
    """Devolve ao pool uma conexao tomada com `get_conn`.

    `db()` cuida disso sozinho; este helper existe para quem precisa manter a
    MESMA conexao aberta por varias transacoes — o caso do lock advisory de
    sessao do sync da planilha (`pg_try_advisory_lock` so vale enquanto a
    conexao que o tomou continuar viva).

    Args:
        conn: a conexao devolvida por `get_conn`.
        close: fecha a conexao em vez de recicla-la. Lock de SESSAO que nao pode
            ser liberado so cai com a sessao; reciclar a conexao o manteria preso.
    """
    _get_pool().putconn(conn, close=close)


def close_pool() -> None:
    """Close all connections in the pool on shutdown."""
    global _pool
    if _pool and not _pool.closed:
        _pool.closeall()


def _add_column_if_not_exists(col: str, coltype: str, table: str = "cert_products") -> None:
    """Add a column to a cert table if it does not already exist.

    Args:
        col: Column name to add.
        coltype: SQL type definition (e.g. 'TEXT DEFAULT ''').
        table: Target table; only literal names from this module are passed.
    """
    c = None
    try:
        c = get_conn()
        with c.cursor() as cur:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {coltype}")
        c.commit()
    except Exception as e:
        # Nao bloqueia o startup, mas deixa rastro: antes a falha era muda e a
        # coluna simplesmente nao existia na primeira query que a usasse.
        log.warning(f"Could not add column {table}.{col}: {e}")
        if c:
            try:
                c.rollback()
            except Exception:
                pass
    finally:
        if c:
            try:
                _get_pool().putconn(c)
            except Exception:
                pass


def _migrate_stock_synced_at_to_timestamptz() -> None:
    """Converte `cert_stock.synced_at` de `timestamp` naive para `TIMESTAMPTZ`.

    A coluna nasceu `TIMESTAMP` (sem time zone) enquanto todo o resto da tabela
    usa `TIMESTAMPTZ`. Os dois — e unicos — caminhos de escrita gravam UTC:

    - `app/services/wms_service.py` insere `datetime.now(UTC).isoformat()`; numa
      coluna naive o Postgres DESCARTA o offset `+00:00` e guarda o relogio UTC;
    - o `DEFAULT NOW()` da propria coluna e avaliado no servidor, cujo container
      nao define `TZ` (ver o servico `postgres` nos dois Compose), entao a sessao
      tambem esta em UTC.

    Logo `AT TIME ZONE 'UTC'` reinterpreta corretamente TODAS as linhas ja
    existentes, independentemente de qual caminho as escreveu.

    Sem a conversao, `synced_at.isoformat()` chega ao navegador sem sufixo de
    fuso e e lido como horario LOCAL: a tela mostrava o sync 3 horas ADIANTE do
    horario real de Brasilia, fazendo o estoque parecer mais fresco do que e.

    Idempotente: consulta `information_schema` antes e nao faz nada quando a
    coluna ja e `timestamp with time zone` (ou quando a tabela nao existe).
    """
    try:
        with db() as (conn, cur):
            cur.execute(
                """
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'cert_stock'
                  AND column_name = 'synced_at'
                """
            )
            row = cur.fetchone()
            if row is None or row["data_type"] != "timestamp without time zone":
                return
            cur.execute(
                "ALTER TABLE cert_stock "
                "ALTER COLUMN synced_at TYPE TIMESTAMPTZ "
                "USING synced_at AT TIME ZONE 'UTC'"
            )
        log.info("Migrated cert_stock.synced_at to TIMESTAMPTZ (values reinterpreted as UTC)")
    except Exception as e:
        # Nao bloqueia o startup: a leitura continua funcionando com a coluna
        # naive (so com o deslocamento de fuso na tela) e a proxima subida tenta
        # de novo.
        log.warning(f"Could not migrate cert_stock.synced_at to TIMESTAMPTZ: {e}")


# Contrato de dados da certificacao (reuniao 2026-09-11, decisao D11). Colunas
# novas de bases ja existentes; bases novas recebem as mesmas pelo mesmo
# caminho, logo depois do CREATE TABLE.
_CERT_PRODUCTS_D11_COLUMNS: list[tuple[str, str]] = [
    # Validade do certificado (col. da aba de produto). Decide ATIVO/ENCERRADO;
    # NAO e data de trava. `_raw` guarda o texto original da planilha.
    ("validade_certificado", "DATE"),
    ("validade_certificado_raw", "TEXT"),
    # Veredito de venda derivado: a trava e a MENOR data real entre fim de
    # venda da certificacao (encerrada) e fim do licenciamento (Linx).
    ("status_venda", "TEXT CHECK (status_venda IN ('LIBERADA', 'BLOQUEADA'))"),
    ("trava_venda", "DATE"),
    ("trava_origem", "TEXT CHECK (trava_origem IN ('certificacao', 'licenciamento'))"),
    # Leitura do Linx (propriedades 00107/00225 e FIM_VENDAS atual do produto).
    # Ano < 2000 (o 01/01/1900 do Linx) e gravado como NULL, nunca como data.
    ("linx_fim_licenciamento", "DATE"),
    ("linx_prop_certificacao", "DATE"),
    ("linx_fim_vendas", "DATE"),
    ("grife", "TEXT"),
    ("linx_synced_at", "TIMESTAMPTZ"),
]

_CERT_CERTIFICATES_D11_COLUMNS: list[tuple[str, str]] = [
    # Fim de venda (trava) do certificado cadastrado. Vazio enquanto ATIVO.
    ("fim_venda", "DATE"),
    ("situacao", "TEXT DEFAULT 'ATIVO' CHECK (situacao IN ('ATIVO', 'ENCERRADO'))"),
]


def _create_d11_tables(cur) -> None:
    """Cria as tabelas novas do contrato D11 (idempotente, sem tocar dado)."""
    # Vinculo N:1 de SKUs a um certificado cadastrado. Remover um item grava
    # removed_at/removed_by (historico), e o unico parcial permite revincular o
    # mesmo SKU depois. RESTRICT: certificado com itens nao some por cascata.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cert_certificate_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            certificate_id UUID NOT NULL
                REFERENCES cert_certificates(id) ON DELETE RESTRICT,
            sku TEXT NOT NULL,
            brand TEXT NOT NULL DEFAULT '',
            produto_codigo TEXT,
            linx_status TEXT NOT NULL DEFAULT 'pending',
            linx_error TEXT,
            linx_detail JSONB,
            linx_applied_at TIMESTAMPTZ,
            added_by TEXT,
            added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            removed_by TEXT,
            removed_at TIMESTAMPTZ
        )
    """)
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS cert_certificate_items_active_uniq "
        "ON cert_certificate_items(certificate_id, sku) WHERE removed_at IS NULL"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS cert_certificate_items_sku_idx "
        "ON cert_certificate_items(sku)"
    )

    # Uma linha por sincronizacao da planilha (botao, startup, agenda, horaria).
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cert_sync_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at TIMESTAMPTZ,
            trigger TEXT NOT NULL
                CHECK (trigger IN ('manual', 'startup', 'schedule', 'hourly')),
            actor TEXT,
            result JSONB,
            error TEXT
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS cert_sync_runs_started_idx "
        "ON cert_sync_runs(started_at DESC)"
    )

    # Auditoria de quebra-cabecas de sellers terceiros no marketplace
    # Imaginarium. Aplicabilidade por quantidade depende de validacao da area.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cert_marketplace_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            vtex_product_id TEXT NOT NULL,
            seller_id TEXT,
            seller_name TEXT,
            name TEXT,
            url TEXT,
            pieces INTEGER,
            cert_text TEXT,
            verdict TEXT NOT NULL
                CHECK (verdict IN ('OK', 'NAO_OK', 'REVISAR', 'NAO_EXIGE')),
            reason TEXT,
            checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            run_id TEXT
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS cert_marketplace_items_run_idx "
        "ON cert_marketplace_items(run_id)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS cert_marketplace_items_product_idx "
        "ON cert_marketplace_items(vtex_product_id, checked_at DESC)"
    )


def _migrate_cert_certificates_d11() -> None:
    """`sku` anulavel e numero de certificado unico por marca (D11).

    O SKU passa a morar em `cert_certificate_items`; a coluna em
    `cert_certificates` fica como legado (tabela vazia em producao em
    2026-09-11). O indice unico so cobre numero NAO nulo: o cadastro grava
    `numero or None`, entao certificado sem numero nao colide.

    Best-effort como `_migrate_stock_synced_at_to_timestamptz`: se uma base
    antiga tiver numeros duplicados, o indice unico falha, o aviso fica no log e
    o startup continua — nunca derruba a API por causa do legado.
    """
    try:
        with db() as (conn, cur):
            cur.execute("ALTER TABLE cert_certificates ALTER COLUMN sku DROP NOT NULL")
    except Exception as e:
        log.warning(f"Could not make cert_certificates.sku nullable: {e}")
    try:
        with db() as (conn, cur):
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS cert_certificates_brand_numero_uniq "
                "ON cert_certificates(brand, numero_certificado) "
                "WHERE numero_certificado IS NOT NULL"
            )
    except Exception as e:
        log.warning(f"Could not create unique index on cert_certificates(brand, numero): {e}")


def verify_item_restriction_schema() -> None:
    """Fail startup when the explicitly deployed item migration is missing.

    This only reads the schema; it never applies the release migration.
    """
    try:
        with db() as (_conn, cur):
            cur.execute("SELECT situacao, fim_venda, restriction_updated_at, restriction_updated_by FROM cert_certificate_items WHERE false")
            cur.execute("SELECT started_at, finished_at, trigger, actor, result, error FROM cert_sync_runs WHERE false")
            cur.execute("SELECT validade_certificado, validade_certificado_raw, status_venda, trava_venda, trava_origem, linx_fim_licenciamento, linx_prop_certificacao, linx_fim_vendas, grife, linx_synced_at FROM cert_products WHERE false")
            cur.execute("SELECT encerramento_numero_certificado FROM cert_products WHERE false")
            cur.execute("SELECT situacao, fim_venda FROM cert_certificates WHERE false")
            cur.execute("""SELECT indexrelid::regclass::text AS name FROM pg_index
                WHERE indisvalid AND indexrelid IN (
                    to_regclass('cert_certificate_items_active_uniq'),
                    to_regclass('cert_sync_runs_started_idx'),
                    to_regclass('cert_item_restriction_events_item_idx'))""")
            indexes = {row["name"].split(".")[-1] for row in cur.fetchall()}
            if indexes != {"cert_certificate_items_active_uniq", "cert_sync_runs_started_idx", "cert_item_restriction_events_item_idx"}:
                raise ValueError("Missing release indexes")
            cur.execute("SELECT item_id, before_state, after_state, reason, actor, created_at FROM cert_certificate_item_restriction_events WHERE false")
            cur.execute("""SELECT conname FROM pg_constraint
                WHERE conrelid = 'cert_certificate_items'::regclass AND convalidated
                AND conname IN ('cert_item_situacao_valid', 'cert_item_deadline_real', 'cert_item_active_without_deadline')""")
            if {row["conname"] for row in cur.fetchall()} != {
                "cert_item_situacao_valid", "cert_item_deadline_real", "cert_item_active_without_deadline"
            }:
                raise ValueError("Missing item restriction constraints")
    except Exception:
        raise RuntimeError(
            "Schema de restricao individual indisponivel: aplicar e verificar explicitamente "
            "as migrations de release (python -m app.db.release_migrations --apply) antes de iniciar cert-api"
        ) from None


def ensure_tables() -> None:
    """Create all cert tables and indexes if they do not exist, then run column migrations."""
    with db() as (conn, cur):
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_products (
                sku TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                brand TEXT NOT NULL DEFAULT '',
                certification_type TEXT DEFAULT '',
                sheet_status TEXT DEFAULT '',
                expected_cert_text TEXT DEFAULT '',
                ecommerce_description TEXT DEFAULT '',
                actual_cert_text TEXT DEFAULT '',
                last_validation_status TEXT,
                last_validation_score DOUBLE PRECISION,
                last_validation_url TEXT,
                last_validation_date TIMESTAMPTZ,
                last_validation_error TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                brand_filter TEXT,
                cron_expression TEXT NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                last_run TIMESTAMPTZ,
                next_run TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_schedule_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                schedule_id UUID REFERENCES cert_schedules(id) ON DELETE CASCADE,
                run_date TIMESTAMPTZ DEFAULT NOW(),
                status TEXT DEFAULT 'completed',
                summary JSONB,
                report_file TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_validation_runs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                status TEXT DEFAULT 'pending',
                brand_filter TEXT,
                total INTEGER DEFAULT 0,
                processed INTEGER DEFAULT 0,
                ok INTEGER DEFAULT 0,
                missing INTEGER DEFAULT 0,
                inconsistent INTEGER DEFAULT 0,
                not_found INTEGER DEFAULT 0,
                started_at TIMESTAMPTZ DEFAULT NOW(),
                finished_at TIMESTAMPTZ,
                report_file TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_stock (
                id SERIAL PRIMARY KEY,
                sku TEXT NOT NULL,
                brand TEXT,
                source TEXT NOT NULL,
                warehouse TEXT,
                quantity INTEGER DEFAULT 0,
                available INTEGER DEFAULT 0,
                reserved INTEGER DEFAULT 0,
                in_transit INTEGER DEFAULT 0,
                situation TEXT,
                storage_area TEXT,
                -- Bases novas ja nascem TIMESTAMPTZ; as antigas sao convertidas
                -- por _migrate_stock_synced_at_to_timestamptz(). Naive aqui fazia
                -- o navegador ler o UTC como horario local (sync 3h adiante).
                synced_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(sku, source, warehouse)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS cert_stock_sku_idx ON cert_stock(sku)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_certificates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                -- Legado: os SKUs moram em cert_certificate_items (D11).
                sku TEXT,
                brand TEXT NOT NULL DEFAULT '',
                produto_codigo TEXT,
                validade_certificado DATE,
                vencimento_licenciamento DATE,
                numero_certificado TEXT,
                ocp TEXT,
                orgao_certificador TEXT,
                pdf_filename TEXT,
                linx_status TEXT NOT NULL DEFAULT 'pending',
                linx_error TEXT,
                linx_detail JSONB,
                linx_applied_at TIMESTAMPTZ,
                created_by TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS cert_certificates_sku_idx ON cert_certificates(sku)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS cert_certificates_created_idx "
            "ON cert_certificates(created_at DESC)"
        )
        # Reprocessos em massa (Reenviar ao Linx) filtram por marca + situacao do Linx
        cur.execute(
            "CREATE INDEX IF NOT EXISTS cert_certificates_brand_linx_idx "
            "ON cert_certificates(brand, linx_status)"
        )

        _create_d11_tables(cur)

    # Column migrations for existing deployments
    for col, coltype in [
        ("certification_type", "TEXT DEFAULT ''"),
        ("sheet_status", "TEXT DEFAULT ''"),
        ("expected_cert_text", "TEXT DEFAULT ''"),
        ("ecommerce_description", "TEXT DEFAULT ''"),
        ("actual_cert_text", "TEXT DEFAULT ''"),
        ("last_validation_error", "TEXT"),
        ("sale_deadline", "TEXT"),
        ("sale_deadline_date", "DATE"),
        ("is_expired", "BOOLEAN DEFAULT FALSE"),
        # Coluna P das abas "Imaginarium"/"Puket" ("Número Certificado") e coluna
        # A da aba "Encerramentos" ("CERTIFICADO") — e o que liga as duas abas.
        ("numero_certificado", "TEXT DEFAULT ''"),
        # Coluna U ("SITUAÇÃO") das abas de produto.
        ("situacao", "TEXT DEFAULT ''"),
        # Coluna H da aba "Encerramentos": "Comerciação Permitida" /
        # "Vencido - Venda Bloqueada" / "Venda até fim do lote". E o veredito
        # sobre poder faturar o item; ver services/derivation.py.
        ("encerramento_status", "TEXT"),
        *_CERT_PRODUCTS_D11_COLUMNS,
    ]:
        _add_column_if_not_exists(col, coltype)

    for col, coltype in _CERT_CERTIFICATES_D11_COLUMNS:
        _add_column_if_not_exists(col, coltype, table="cert_certificates")

    _migrate_stock_synced_at_to_timestamptz()
    _migrate_cert_certificates_d11()


def ensure_li_tracking_table() -> None:
    """Create li_tracking table if it does not exist."""
    with db() as (conn, cur):
        cur.execute("""
            CREATE TABLE IF NOT EXISTS li_tracking (
                id SERIAL PRIMARY KEY,
                process_id INTEGER,
                process_code TEXT,
                ncm TEXT,
                orgao TEXT,
                supplier TEXT,
                item TEXT,
                description TEXT,
                status TEXT DEFAULT 'pending',
                lpco_number TEXT,
                valid_until DATE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
