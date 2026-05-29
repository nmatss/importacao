#!/usr/bin/env bash
# Apply pending SQL migrations against the Postgres container.
# Idempotent: each .sql uses IF NOT EXISTS / ADD VALUE IF NOT EXISTS, so
# re-running this is safe.
#
# Usage:
#   /opt/importacao/scripts/apply-pending-migrations.sh
#
# Override container name with PG_CONTAINER, DB user/name via PG_USER/PG_DB.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-importacao-postgres}"
PG_USER="${PG_USER:-importacao}"
PG_DB="${PG_DB:-importacao}"

# Find the project root (this script's directory's parent).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DRIZZLE_DIR="$ROOT/apps/api/drizzle"

apply() {
  local file="$1"
  if [[ ! -f "$DRIZZLE_DIR/$file" ]]; then
    echo "[skip] $file (not found)" >&2
    return
  fi
  echo "[$(date '+%H:%M:%S')] applying $file"
  docker cp "$DRIZZLE_DIR/$file" "$PG_CONTAINER:/tmp/$file"
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -f "/tmp/$file"
}

# Apply in order. Each is idempotent via IF NOT EXISTS / ADD VALUE IF NOT EXISTS.
apply 0011_proforma_invoice.sql
apply 0012_process_rename_and_lock.sql
apply 0013_ai_usage_log.sql
apply 0014_validation_resolution_note.sql

echo "[$(date '+%H:%M:%S')] done — pending migrations applied"
