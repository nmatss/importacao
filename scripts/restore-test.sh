#!/usr/bin/env bash
# =============================================================================
# restore-test.sh — Weekly restore validation test
# =============================================================================
# Recommended crontab (weekly, Sunday at 03:00):
#   0 3 * * 0 /home/nicolas/importacao/scripts/restore-test.sh >> /var/log/importacao-restore-test.log 2>&1
# =============================================================================
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-importacao-postgres}"
POSTGRES_USER="${POSTGRES_USER:-importacao}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/backups/importacao}"
TEST_DB="${TEST_DB:-importacao_restore_test}"
MIN_TABLES="${MIN_TABLES:-10}"
MIN_ROWS_PROCESSES="${MIN_ROWS_PROCESSES:-1}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ERROR: $*"; exit 1; }

LATEST_BACKUP="$(find "${BACKUP_LOCAL_DIR}" -name "importacao_*.pgdump" -type f \
  -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | awk '{print $2}')"

if [[ -z "${LATEST_BACKUP}" ]]; then
  die "No backup files found in ${BACKUP_LOCAL_DIR}"
fi

log "Latest backup: ${LATEST_BACKUP}"
BACKUP_AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "${LATEST_BACKUP}") ) / 3600 ))
log "Backup age: ${BACKUP_AGE_HOURS} hours"

if [[ "${BACKUP_AGE_HOURS}" -gt 26 ]]; then
  log "WARNING: Latest backup is older than 26 hours — backup process may be broken"
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  die "Container '${CONTAINER_NAME}' is not running."
fi

log "Dropping test DB if exists: ${TEST_DB}..."
docker exec "${CONTAINER_NAME}" \
  psql -U "${POSTGRES_USER}" -c "DROP DATABASE IF EXISTS ${TEST_DB};" postgres

log "Creating test DB: ${TEST_DB}..."
docker exec "${CONTAINER_NAME}" \
  psql -U "${POSTGRES_USER}" -c "CREATE DATABASE ${TEST_DB};" postgres

log "Restoring backup into ${TEST_DB}..."
docker exec -i "${CONTAINER_NAME}" \
  pg_restore -U "${POSTGRES_USER}" -d "${TEST_DB}" --no-owner --no-acl \
  < "${LATEST_BACKUP}" \
  || die "pg_restore failed"

log "Restore completed. Running sanity checks..."

TABLE_COUNT="$(docker exec "${CONTAINER_NAME}" \
  psql -U "${POSTGRES_USER}" -d "${TEST_DB}" -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")"

log "Tables found: ${TABLE_COUNT} (minimum: ${MIN_TABLES})"
if [[ "${TABLE_COUNT}" -lt "${MIN_TABLES}" ]]; then
  die "Table count ${TABLE_COUNT} below minimum ${MIN_TABLES}"
fi

PROCESS_COUNT="$(docker exec "${CONTAINER_NAME}" \
  psql -U "${POSTGRES_USER}" -d "${TEST_DB}" -tAc \
  "SELECT COUNT(*) FROM import_processes;" 2>/dev/null || echo "0")"

log "import_processes rows: ${PROCESS_COUNT} (minimum: ${MIN_ROWS_PROCESSES})"
if [[ "${PROCESS_COUNT}" -lt "${MIN_ROWS_PROCESSES}" ]]; then
  log "WARNING: import_processes count below expected"
fi

log "Cleaning up test DB: ${TEST_DB}..."
docker exec "${CONTAINER_NAME}" \
  psql -U "${POSTGRES_USER}" -c "DROP DATABASE ${TEST_DB};" postgres

log "Restore test PASSED. Tables: ${TABLE_COUNT}, Processes: ${PROCESS_COUNT}"
