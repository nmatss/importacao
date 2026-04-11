"""PostgreSQL connection pool and context manager."""

import threading
from collections.abc import Generator
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool

from app.config import DATABASE_URL

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
                synced_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(sku, source, warehouse)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS cert_stock_sku_idx ON cert_stock(sku)")

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
    ]:
        _add_column_if_not_exists(col, coltype)


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
