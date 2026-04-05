#!/usr/bin/env bash
# =============================================================================
# backup-db.sh — PostgreSQL backup with remote upload and volume archiving
# =============================================================================
# Recommended crontab (daily at 02:00):
#   0 2 * * * /home/nicolas/importacao/scripts/backup-db.sh >> /var/log/importacao-backup.log 2>&1
#
# Environment variables:
#   CONTAINER_NAME        Docker container name (default: importacao-postgres)
#   POSTGRES_DB           Database name (default: importacao)
#   POSTGRES_USER         Database user (default: importacao)
#   BACKUP_LOCAL_DIR      Local backup dir (default: /backups/importacao)
#   RETENTION_DAYS        Days to keep local backups (default: 7)
#   BACKUP_REMOTE_HOST    Remote host for rsync (optional)
#   BACKUP_REMOTE_PATH    Remote path for rsync (optional)
#   BACKUP_S3_BUCKET      S3/MinIO bucket (optional, e.g. s3://my-bucket/importacao)
#   UPLOADS_DIR           Uploads volume path (default: /var/lib/docker/volumes/importacao_uploads/_data)
#   CERT_REPORTS_DIR      Cert-reports volume path (default: /var/lib/docker/volumes/importacao_cert-reports/_data)
#
# Remote mode (called by deploy.sh):
#   backup-db.sh --remote <server> --user <user>
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Remote delegation mode
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--remote" ]]; then
  REMOTE_HOST="${2:?--remote requires a host}"
  REMOTE_USER="${4:-nicolas}"
  ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd ~/importacao && bash scripts/backup-db.sh"
  exit $?
fi

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CONTAINER_NAME="${CONTAINER_NAME:-importacao-postgres}"
DB_NAME="${POSTGRES_DB:-importacao}"
DB_USER="${POSTGRES_USER:-importacao}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/backups/importacao}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP="$(date +"%Y-%m-%d_%H%M%S")"
BACKUP_BASE="importacao_${TIMESTAMP}"
BACKUP_FILE="${BACKUP_BASE}.pgdump"

UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/docker/volumes/importacao_uploads/_data}"
CERT_REPORTS_DIR="${CERT_REPORTS_DIR:-/var/lib/docker/volumes/importacao_cert-reports/_data}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ERROR: $*"; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  die "Container '${CONTAINER_NAME}' is not running."
fi

mkdir -p "${BACKUP_LOCAL_DIR}" || die "Cannot create backup directory ${BACKUP_LOCAL_DIR}"

# ---------------------------------------------------------------------------
# PostgreSQL backup (custom format: compressed + parallel-restore capable)
# ---------------------------------------------------------------------------
log "Starting pg_dump (custom format -Fc) of '${DB_NAME}'..."
docker exec "${CONTAINER_NAME}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-acl -Fc \
  > "${BACKUP_LOCAL_DIR}/${BACKUP_FILE}" \
  || die "pg_dump failed"

BACKUP_SIZE="$(du -h "${BACKUP_LOCAL_DIR}/${BACKUP_FILE}" | cut -f1)"
log "Backup created: ${BACKUP_LOCAL_DIR}/${BACKUP_FILE} (${BACKUP_SIZE})"

# ---------------------------------------------------------------------------
# Integrity check
# ---------------------------------------------------------------------------
log "Verifying backup integrity with pg_restore --list..."
docker exec "${CONTAINER_NAME}" sh -c \
  "pg_restore --list /dev/stdin" < "${BACKUP_LOCAL_DIR}/${BACKUP_FILE}" > /dev/null \
  || die "Backup integrity check FAILED"
log "Backup integrity OK."

# ---------------------------------------------------------------------------
# Volume backups
# ---------------------------------------------------------------------------
for vol_name in uploads cert-reports; do
  if [[ "${vol_name}" == "uploads" ]]; then
    VOL_DIR="${UPLOADS_DIR}"
  else
    VOL_DIR="${CERT_REPORTS_DIR}"
  fi

  if [[ -d "${VOL_DIR}" ]]; then
    VOL_ARCHIVE="${BACKUP_LOCAL_DIR}/${BACKUP_BASE}_${vol_name}.tar.gz"
    log "Archiving volume ${vol_name} -> ${VOL_ARCHIVE}..."
    tar -czf "${VOL_ARCHIVE}" -C "$(dirname "${VOL_DIR}")" "$(basename "${VOL_DIR}")" \
      || log "WARNING: Volume archive failed for ${vol_name}"
    log "Volume archive: $(du -h "${VOL_ARCHIVE}" | cut -f1)"
  else
    log "WARNING: Volume dir not found, skipping: ${VOL_DIR}"
  fi
done

# ---------------------------------------------------------------------------
# Remote upload (rsync)
# ---------------------------------------------------------------------------
if [[ -n "${BACKUP_REMOTE_HOST:-}" && -n "${BACKUP_REMOTE_PATH:-}" ]]; then
  log "Uploading to remote: ${BACKUP_REMOTE_HOST}:${BACKUP_REMOTE_PATH}..."
  rsync -az "${BACKUP_LOCAL_DIR}/${BACKUP_BASE}"* \
    "${BACKUP_REMOTE_HOST}:${BACKUP_REMOTE_PATH}/" \
    || log "WARNING: Remote rsync failed"
  log "Remote upload complete."
fi

# ---------------------------------------------------------------------------
# S3/MinIO upload
# ---------------------------------------------------------------------------
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  log "Uploading to S3/MinIO: ${BACKUP_S3_BUCKET}..."
  if command -v mc > /dev/null 2>&1; then
    mc cp "${BACKUP_LOCAL_DIR}/${BACKUP_FILE}" "${BACKUP_S3_BUCKET}/${BACKUP_FILE}" \
      || log "WARNING: MinIO upload failed"
  elif command -v aws > /dev/null 2>&1; then
    aws s3 cp "${BACKUP_LOCAL_DIR}/${BACKUP_FILE}" "${BACKUP_S3_BUCKET}/${BACKUP_FILE}" \
      || log "WARNING: S3 upload failed"
  else
    log "WARNING: BACKUP_S3_BUCKET set but neither 'mc' nor 'aws' CLI found"
  fi
fi

# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------
log "Applying retention policy: removing backups older than ${RETENTION_DAYS} days..."
DELETED="$(find "${BACKUP_LOCAL_DIR}" \( -name "importacao_*.pgdump" -o -name "importacao_*.tar.gz" \) \
  -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
log "Deleted ${DELETED} old backup file(s)."

log "Backup completed successfully."
log "Files: ${BACKUP_LOCAL_DIR}/${BACKUP_BASE}*"
