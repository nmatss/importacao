#!/bin/bash
# =============================================================================
# Automated PostgreSQL backup for importacao
# =============================================================================
# Recommended crontab entry (daily at 2 AM):
#   0 2 * * * /home/nicolas/importacao/scripts/backup-db.sh >> /var/log/importacao-backup.log 2>&1
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONTAINER_NAME="importacao-postgres"
DB_NAME="${POSTGRES_DB:-importacao}"
DB_USER="${POSTGRES_USER:-importacao}"
BACKUP_DIR="/backups/importacao"
RETENTION_DAYS=7
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILE="importacao_${TIMESTAMP}.sql.gz"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

die() {
  log "ERROR: $*"
  exit 1
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  die "Container '${CONTAINER_NAME}' is not running."
fi

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}" || die "Cannot create backup directory ${BACKUP_DIR}"

# ---------------------------------------------------------------------------
# Perform backup
# ---------------------------------------------------------------------------
log "Starting backup of database '${DB_NAME}' from container '${CONTAINER_NAME}'..."

docker exec "${CONTAINER_NAME}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-acl \
  | gzip > "${BACKUP_DIR}/${BACKUP_FILE}" \
  || die "pg_dump failed"

BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
log "Backup created: ${BACKUP_DIR}/${BACKUP_FILE} (${BACKUP_SIZE})"

# ---------------------------------------------------------------------------
# Retention: delete backups older than ${RETENTION_DAYS} days
# ---------------------------------------------------------------------------
log "Applying retention policy: removing backups older than ${RETENTION_DAYS} days..."
DELETED=$(find "${BACKUP_DIR}" -name "importacao_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -print -delete | wc -l)
log "Deleted ${DELETED} old backup(s)."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
log "Backup completed successfully."
