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


def close_pool() -> None:
    """Close all connections in the pool on shutdown."""
    global _pool
    if _pool and not _pool.closed:
        _pool.closeall()


def _add_column_if_not_exists(col: str, coltype: str) -> None:
    """Add a column to cert_products if it does not already exist.

    Args:
        col: Column name to add.
        coltype: SQL type definition (e.g. 'TEXT DEFAULT ''').
    """
    c = None
    try:
        c = get_conn()
        with c.cursor() as cur:
            cur.execute(f"ALTER TABLE cert_products ADD COLUMN IF NOT EXISTS {col} {coltype}")
        c.commit()
    except Exception:
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
                sku TEXT NOT NULL,
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
    ]:
        _add_column_if_not_exists(col, coltype)

    _migrate_stock_synced_at_to_timestamptz()


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
