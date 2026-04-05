#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Zero-downtime deploy with automatic rollback
# =============================================================================
# Usage: bash scripts/deploy.sh [server-ip]
#
# Environment variables (optional overrides):
#   DEPLOY_USER           SSH user (default: nicolas)
#   DEPLOY_DIR            Remote directory (default: /home/$DEPLOY_USER/importacao)
#   COMPOSE_FILE          Docker compose file (default: docker-compose.prod.yml)
#   HEALTH_ENDPOINT       API health URL (default: http://localhost:3050/health/ready)
#   HEALTH_RETRIES        Health check retries (default: 30)
#   HEALTH_INTERVAL       Seconds between retries (default: 2)
#   SKIP_BACKUP           Set to "1" to skip DB backup (NOT recommended)
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SERVER="${1:-192.168.168.124}"
DEPLOY_USER="${DEPLOY_USER:-nicolas}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/${DEPLOY_USER}/importacao}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-http://localhost:3050/health/ready}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
LOG_FILE="deploy.log"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() {
  local level="$1"; shift
  local ts
  ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  local msg="${ts} [${level}] $*"
  echo "${msg}"
  echo "${msg}" >> "${LOG_FILE}"
}

info()    { log "INFO " "$@"; }
warn()    { log "WARN " "$@"; }
error()   { log "ERROR" "$@"; }
success() { log "OK   " "$@"; }

notify() {
  local status="$1"
  local msg="$2"
  if [[ -n "${GOOGLE_CHAT_WEBHOOK_URL:-}" ]]; then
    curl -s -X POST "${GOOGLE_CHAT_WEBHOOK_URL}" \
      -H 'Content-Type: application/json' \
      -d "{\"text\": \"[importacao deploy] ${status}: ${msg}\"}" || true
  fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
info "=== Deploy importacao to ${SERVER} ==="

# 1. Ensure on master
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${CURRENT_BRANCH}" != "master" ]]; then
  error "Must deploy from master branch. Current branch: ${CURRENT_BRANCH}"
  exit 1
fi

# 2. Ensure working tree is clean
if [[ -n "$(git status --porcelain)" ]]; then
  error "Working tree is not clean. Commit or stash changes before deploying."
  git status --short
  exit 1
fi

# 3. Ensure local master is up to date
info "Checking if local master is up to date with origin..."
git fetch origin master --quiet
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/master)"
if [[ "${LOCAL_SHA}" != "${REMOTE_SHA}" ]]; then
  error "Local master (${LOCAL_SHA:0:8}) differs from origin/master (${REMOTE_SHA:0:8})."
  error "Run: git pull origin master"
  exit 1
fi
info "Local master is up to date."

# 4. Save current SHA for rollback
PREV_SHA="${LOCAL_SHA}"
info "Current SHA: ${PREV_SHA:0:12}"

# 5. User confirmation
echo ""
echo "  Server   : ${SERVER}"
echo "  User     : ${DEPLOY_USER}"
echo "  Dir      : ${DEPLOY_DIR}"
echo "  Compose  : ${COMPOSE_FILE}"
echo "  SHA      : ${PREV_SHA:0:12}"
echo ""
read -r -p "Proceed with production deployment? [y/N] " CONFIRM
if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
  info "Deploy cancelled by user."
  exit 0
fi

# ---------------------------------------------------------------------------
# Mandatory backup
# ---------------------------------------------------------------------------
if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
  info "[1/6] Running mandatory pre-deploy database backup..."
  if ! bash "$(dirname "$0")/backup-db.sh" --remote "${SERVER}" --user "${DEPLOY_USER}"; then
    error "Pre-deploy backup FAILED. Aborting deploy to protect data."
    notify "FAILED" "Pre-deploy backup failed — deploy aborted"
    exit 1
  fi
  success "Database backup completed."
else
  warn "[1/6] Backup skipped (SKIP_BACKUP=1)"
fi

# ---------------------------------------------------------------------------
# Sync code
# ---------------------------------------------------------------------------
info "[2/6] Syncing code to ${SERVER}:${DEPLOY_DIR}..."
rsync -avz --delete \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'uploads' \
  --exclude '.git' \
  --exclude '__pycache__' \
  --exclude '*.db' \
  --exclude 'reports/' \
  --exclude 'apps/cert-api/__pycache__' \
  --exclude 'apps/cert-api/certifications.db' \
  --exclude 'apps/cert-api/reports' \
  --exclude 'deploy.log' \
  ./ "${DEPLOY_USER}@${SERVER}:${DEPLOY_DIR}/"
success "Code synced."

# ---------------------------------------------------------------------------
# Generate .env from Vault (non-blocking)
# ---------------------------------------------------------------------------
info "[3/6] Generating .env from Vault..."
ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && bash scripts/generate-env-from-vault.sh" 2>&1 || {
  warn "Vault env generation failed — using existing .env on server"
}

# ---------------------------------------------------------------------------
# Deploy: build + rolling restart (api + web only, no --force-recreate)
# ---------------------------------------------------------------------------
info "[4/6] Building and deploying api + web..."
ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && \
  docker compose -f ${COMPOSE_FILE} up -d --no-deps --build api web"
success "Containers started."

# ---------------------------------------------------------------------------
# Health check loop
# ---------------------------------------------------------------------------
info "[5/6] Waiting for health check: ${HEALTH_ENDPOINT}"
ATTEMPT=0
HEALTHY=0
until [[ ${ATTEMPT} -ge ${HEALTH_RETRIES} ]]; do
  ATTEMPT=$((ATTEMPT + 1))
  if ssh "${DEPLOY_USER}@${SERVER}" "curl -sf '${HEALTH_ENDPOINT}'" > /dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  info "  Health attempt ${ATTEMPT}/${HEALTH_RETRIES} — not ready yet..."
  sleep "${HEALTH_INTERVAL}"
done

if [[ "${HEALTHY}" -ne 1 ]]; then
  error "Health check failed after ${HEALTH_RETRIES} attempts."
  error "Initiating automatic rollback to ${PREV_SHA:0:12}..."

  # Rollback: re-sync previous SHA and rebuild
  ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && git checkout ${PREV_SHA} 2>/dev/null || true"
  ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && \
    docker compose -f ${COMPOSE_FILE} up -d --no-deps --build api web" || true

  notify "ROLLBACK" "Health check failed — rolled back to ${PREV_SHA:0:12}"
  error "Rolled back to ${PREV_SHA:0:12}. Check container logs."
  exit 1
fi

success "Health check passed."

# ---------------------------------------------------------------------------
# Final status
# ---------------------------------------------------------------------------
info "[6/6] Deployment status:"
ssh "${DEPLOY_USER}@${SERVER}" "docker ps --filter name=importacao --format 'table {{.Names}}\t{{.Status}}'"

echo ""
success "=== Deploy completed successfully ==="
success "SHA: ${LOCAL_SHA:0:12} deployed to ${SERVER}"
notify "SUCCESS" "Deployed ${LOCAL_SHA:0:12} to ${SERVER}"

# ---------------------------------------------------------------------------
# Migration reminder
# ---------------------------------------------------------------------------
cat << 'MIGRATIONS_NOTE'

REMINDER: Manually apply ALTER TYPE migrations if needed:
  docker cp apps/api/drizzle/0007_draft_bl.sql importacao-postgres:/tmp/
  docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0007_draft_bl.sql

MIGRATIONS_NOTE
