#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Production deploy with automatic CODE rollback on health failure
# Note: rsync-based deploy (the server is NOT a git repo). Rollback restores the
# previous CODE from an on-server snapshot; it does NOT roll back database
# migrations (forward-only). Not zero-downtime: api/web are rebuilt in place.
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

# 4. SHA being deployed (rollback restores code from an on-server snapshot,
#    not from a SHA — the server is not a git repo).
DEPLOY_SHA="${LOCAL_SHA}"
info "Deploying SHA: ${DEPLOY_SHA:0:12}"

# 5. User confirmation
echo ""
echo "  Server   : ${SERVER}"
echo "  User     : ${DEPLOY_USER}"
echo "  Dir      : ${DEPLOY_DIR}"
echo "  Compose  : ${COMPOSE_FILE}"
echo "  SHA      : ${DEPLOY_SHA:0:12}"
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
# Snapshot current release for rollback (rsync model — server has no .git)
# ---------------------------------------------------------------------------
ROLLBACK_DIR="${DEPLOY_DIR}.rollback"
ROLLBACK_READY=0
info "Snapshotting current release to ${ROLLBACK_DIR} for rollback..."
if ssh "${DEPLOY_USER}@${SERVER}" "test -d ${DEPLOY_DIR}"; then
  # cp -al = fast hardlink copy; fall back to a full copy if hardlinks fail.
  if ssh "${DEPLOY_USER}@${SERVER}" "rm -rf ${ROLLBACK_DIR} && { cp -al ${DEPLOY_DIR} ${ROLLBACK_DIR} 2>/dev/null || cp -a ${DEPLOY_DIR} ${ROLLBACK_DIR}; }"; then
    ROLLBACK_READY=1
    success "Snapshot ready (previous release preserved)."
  else
    warn "Could not snapshot current release — AUTOMATIC ROLLBACK WILL BE UNAVAILABLE."
  fi
else
  warn "Remote dir does not exist yet (first deploy) — no rollback snapshot."
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
  --exclude '.venv' \
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
# Apply pending SQL migrations (idempotente — mesmo script do caminho manual)
# ---------------------------------------------------------------------------
info "[4.5/6] Applying pending SQL migrations..."
ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && bash scripts/apply-pending-migrations.sh" 2>&1 || {
  warn "Migrations falharam — rode manualmente: ${DEPLOY_DIR}/scripts/apply-pending-migrations.sh"
  notify "WARN" "Deploy ${LOCAL_SHA:0:12}: migrations falharam, aplicar manualmente"
}

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

  if [[ "${ROLLBACK_READY}" -eq 1 ]]; then
    error "Rolling CODE back to the previous release from snapshot..."
    # Restore previous code from the snapshot, preserving live .env/secrets.
    ssh "${DEPLOY_USER}@${SERVER}" "rsync -a --delete --exclude '.env' ${ROLLBACK_DIR}/ ${DEPLOY_DIR}/" || \
      error "Snapshot restore command failed — release may be inconsistent."
    ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && \
      docker compose -f ${COMPOSE_FILE} up -d --no-deps --build api web" || true

    # Re-check health so we report the TRUTH, not a hopeful message.
    RB_OK=0
    RB_ATTEMPT=0
    until [[ ${RB_ATTEMPT} -ge ${HEALTH_RETRIES} ]]; do
      RB_ATTEMPT=$((RB_ATTEMPT + 1))
      if ssh "${DEPLOY_USER}@${SERVER}" "curl -sf '${HEALTH_ENDPOINT}'" > /dev/null 2>&1; then
        RB_OK=1; break
      fi
      sleep "${HEALTH_INTERVAL}"
    done

    if [[ "${RB_OK}" -eq 1 ]]; then
      warn "Rolled back to the previous release — health is GREEN again."
      notify "ROLLBACK" "Health failed on ${LOCAL_SHA:0:12} — rolled back to previous release (healthy)"
    else
      error "Rollback applied but health is STILL failing — MANUAL INTERVENTION REQUIRED."
      notify "ROLLBACK-FAILED" "Health failed AND rollback unhealthy on ${SERVER} — manual intervention"
    fi
  else
    error "No rollback snapshot available — leaving the current (failed) release in place."
    error "MANUAL INTERVENTION REQUIRED on ${SERVER}:${DEPLOY_DIR}."
    notify "FAILED" "Health failed on ${LOCAL_SHA:0:12} and no rollback snapshot — manual intervention on ${SERVER}"
  fi

  warn "Database migrations are forward-only and were NOT rolled back — verify schema/data state."
  exit 1
fi

success "Health check passed."

# Deploy succeeded — drop the rollback snapshot to reclaim space.
if [[ "${ROLLBACK_READY}" -eq 1 ]]; then
  ssh "${DEPLOY_USER}@${SERVER}" "rm -rf ${ROLLBACK_DIR}" 2>/dev/null || \
    warn "Could not remove rollback snapshot ${ROLLBACK_DIR} — remove it manually."
fi

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

NOTE: migrations já rodam automaticamente no passo [4.5/6]. O manual abaixo
fica como fallback caso aquele passo tenha falhado:

  # 0011 (ALTER TYPE — MUST be manual, can't run in transaction)
  docker cp apps/api/drizzle/0011_proforma_invoice.sql importacao-postgres:/tmp/
  docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0011_proforma_invoice.sql

  # 0012 (ADD COLUMN — process lock + rename)
  docker cp apps/api/drizzle/0012_process_rename_and_lock.sql importacao-postgres:/tmp/
  docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0012_process_rename_and_lock.sql

  # 0013 (CREATE TABLE — AI usage log, drives monthly budget cap)
  docker cp apps/api/drizzle/0013_ai_usage_log.sql importacao-postgres:/tmp/
  docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0013_ai_usage_log.sql

  # 0014 (ADD COLUMN — validation_results.resolution_note, justificativa do aceite manual)
  docker cp apps/api/drizzle/0014_validation_resolution_note.sql importacao-postgres:/tmp/
  docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0014_validation_resolution_note.sql

  # 0015 (CREATE TABLE — historização de validações e extrações, auditoria regulatória)
  docker cp apps/api/drizzle/0015_validation_history.sql importacao-postgres:/tmp/
  docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0015_validation_history.sql

  # OR run them all at once:
  /opt/importacao/scripts/apply-pending-migrations.sh

NEW ENV VARS (set in .env.production before restarting API):
  AI_PROVIDER=openrouter                          # 'vertex' to switch when ready
  AI_MONTHLY_BUDGET_USD=200                       # ≈ R$ 1000
  AI_UPGRADE_ON_LOW_CONFIDENCE=1                  # default ON
  AI_UPGRADE_CONFIDENCE_THRESHOLD=0.7
  AI_UPGRADE_MIN_DELTA=0.05
  VIMBAR_AUTO_LOCK=1
  VIMBAR_SENDER_DOMAINS=                          # CSV — EMPTY = lock disabled (fail-closed)
  AUTO_GENERATE_ESPELHO=1
  AUTO_CLEAN_ITEM_CODES=1
  # Pasta criada em 2026-06-11 na área de importação do Drive ("Pre-Cons (sync
  # portal importação)"); compartilhar com a SA n8n-automacao@n8n-grupo-unico
  GOOGLE_DRIVE_PRE_CONS_FOLDER_ID=1OJmEV1GTI7vC0B-Uxb-btgQRMDu0530B
  # Vertex-only (leave blank until you wire it):
  # GOOGLE_VERTEX_PROJECT=
  # GOOGLE_VERTEX_LOCATION=us-central1

MIGRATIONS_NOTE
