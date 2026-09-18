"""Explicit release DDL. Default is read-only checking; --apply enables migration."""

import argparse
from pathlib import Path

from app.db.postgres import close_pool, db, ensure_tables, verify_item_restriction_schema

MIGRATION = Path(__file__).resolve().parents[2] / "sql" / "20260912_certificate_item_restrictions.sql"
ENCERRAMENTO_MIGRATION = MIGRATION.with_name("20260918_encerramento_provenance.sql")


def apply_release_migrations() -> None:
    # Validate the packaged artifact before changing any schema.
    statements = [path.read_text(encoding="utf-8") for path in (MIGRATION, ENCERRAMENTO_MIGRATION)]
    ensure_tables()
    for sql in statements:
        with db() as (_conn, cur):
            cur.execute(sql)
    verify_item_restriction_schema()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Apply explicit additive release migration")
    mode.add_argument("--check", action="store_true", help="Check only (default)")
    args = parser.parse_args(argv)
    try:
        if args.apply:
            apply_release_migrations()
        else:
            verify_item_restriction_schema()
        print("Cert-api release schema verified")
        return 0
    except Exception as exc:
        print(f"Cert-api release schema failed ({type(exc).__name__}); verify migration prerequisite")
        return 1
    finally:
        close_pool()


if __name__ == "__main__":
    raise SystemExit(main())
