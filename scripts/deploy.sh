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
#   WEB_HEALTH_ENDPOINT   Web health URL (default: http://localhost:8085/)
#   PUBLIC_WEB_HEALTH_ENDPOINT Optional public HTTPS/frontend URL to validate
#   ALLOW_SYDLE_SYNC_DEPLOY Set to "1" to allow SYDLE_SYNC_ENABLED=true after UAT
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
WEB_HEALTH_ENDPOINT="${WEB_HEALTH_ENDPOINT:-http://localhost:8085/}"
PUBLIC_WEB_HEALTH_ENDPOINT="${PUBLIC_WEB_HEALTH_ENDPOINT:-}"
ALLOW_SYDLE_SYNC_DEPLOY="${ALLOW_SYDLE_SYNC_DEPLOY:-0}"
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
  info "[1/8] Running mandatory pre-deploy database backup..."
  if ! bash "$(dirname "$0")/backup-db.sh" --remote "${SERVER}" --user "${DEPLOY_USER}"; then
    error "Pre-deploy backup FAILED. Aborting deploy to protect data."
    notify "FAILED" "Pre-deploy backup failed — deploy aborted"
    exit 1
  fi
  success "Database backup completed."
else
  warn "[1/8] Backup skipped (SKIP_BACKUP=1)"
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
info "[2/8] Syncing code to ${SERVER}:${DEPLOY_DIR}..."
rsync -avz --delete \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'uploads' \
  --exclude 'logs' \
  --exclude '.git' \
  --exclude '.claude' \
  --exclude '.codex' \
  --exclude '__pycache__' \
  --exclude '.venv' \
  --exclude '*.db' \
  --exclude 'reports/' \
  --exclude 'apps/cert-api/__pycache__' \
  --exclude 'apps/cert-api/certifications.db' \
  --exclude 'apps/cert-api/reports' \
  --exclude 'deploy.log' \
  ./ "${DEPLOY_USER}@${SERVER}:${DEPLOY_DIR}/"
ssh "${DEPLOY_USER}@${SERVER}" "mkdir -p ${DEPLOY_DIR}/logs"
success "Code synced."

# ---------------------------------------------------------------------------
# Generate .env from SOPS or Vault (non-blocking)
# ---------------------------------------------------------------------------
info "[3/8] Generating .env from SOPS/Vault..."
if ssh "${DEPLOY_USER}@${SERVER}" "test -f ${DEPLOY_DIR}/.env.sops.yaml"; then
  if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && bash scripts/generate-env-from-vault.sh --sops"; then
    error "SOPS env generation failed. Deploy aborted to avoid using stale remote secrets."
    notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: SOPS env generation failed"
    exit 1
  fi
else
  error "Missing ${DEPLOY_DIR}/.env.sops.yaml after sync. Deploy aborted."
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: .env.sops.yaml missing"
  exit 1
fi

info "Checking SYDLE sync rollout flag..."
SYDLE_SYNC_REMOTE="$(
  ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && awk -F= '
    BEGIN { IGNORECASE = 1 }
    /^[[:space:]]*SYDLE_SYNC_ENABLED[[:space:]]*=/ {
      v = \$2
      gsub(/[[:space:]\"]/, \"\", v)
      gsub(/\047/, \"\", v)
      print tolower(v)
    }
  ' .env 2>/dev/null | tail -n 1"
)"
case "${SYDLE_SYNC_REMOTE}" in
  true|1|yes)
    if [[ "${ALLOW_SYDLE_SYNC_DEPLOY}" != "1" ]]; then
      error "SYDLE_SYNC_ENABLED=true in remote .env. Deploy blocked until SYDLE contract, stable payment ID, payload mapping and finance UAT are approved."
      error "Set ALLOW_SYDLE_SYNC_DEPLOY=1 only for the approved real SYDLE rollout."
      notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: SYDLE sync enabled without rollout approval"
      exit 1
    fi
    warn "SYDLE_SYNC_ENABLED=true allowed by ALLOW_SYDLE_SYNC_DEPLOY=1."
    ;;
  *)
    success "SYDLE sync remains disabled for this deploy."
    ;;
esac

info "[4/8] Rendering Alertmanager config..."
ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && python3 -" <<'PY'
from pathlib import Path
import shlex
import sys

env_file = Path(".env")
target = Path("infra/alertmanager/alertmanager.yml")
template = Path("infra/alertmanager/alertmanager.webhook.yml.template")


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        try:
            parts = shlex.split(raw_value, posix=True)
        except ValueError:
            parts = []
        values[key] = parts[0] if parts else raw_value.strip().strip('"').strip("'")
    return values


webhook_url = parse_env(env_file).get("ALERTMANAGER_WEBHOOK_URL", "").strip()
if not webhook_url:
    print("ALERTMANAGER_WEBHOOK_URL is empty; keeping checked-in noop Alertmanager config.")
    sys.exit(0)

if "chat.googleapis.com" in webhook_url:
    print(
        "ERROR: ALERTMANAGER_WEBHOOK_URL must point to an Alertmanager webhook bridge, "
        "not directly to Google Chat.",
        file=sys.stderr,
    )
    sys.exit(1)

if not template.exists():
    print(f"ERROR: missing template {template}", file=sys.stderr)
    sys.exit(1)

yaml_url = webhook_url.replace("'", "''")
target.write_text(
    template.read_text(encoding="utf-8").replace("${ALERTMANAGER_WEBHOOK_URL}", yaml_url),
    encoding="utf-8",
)
print(f"Rendered {target} from {template}.")
PY

# ---------------------------------------------------------------------------
# Apply pending SQL migrations (idempotente — mesmo script do caminho manual)
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Validate remote compose before migrations/restart
# ---------------------------------------------------------------------------
info "[5/8] Validating production compose config..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && docker compose -f ${COMPOSE_FILE} config --quiet"; then
  error "Remote compose config is invalid. Deploy aborted before migrations/restart."
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: compose config invalid"
  exit 1
fi
success "Remote compose config valid."

info "Checking external Docker network ia-local-net..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "docker network inspect ia-local-net >/dev/null 2>&1"; then
  error "External Docker network ia-local-net is missing. Create/connect the IA Local network before deploy."
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: missing ia-local-net"
  exit 1
fi
success "External Docker network ia-local-net exists."

# ---------------------------------------------------------------------------
# Apply pending SQL migrations (idempotente — mesmo script do caminho manual)
# ---------------------------------------------------------------------------
info "[6/8] Applying pending SQL migrations..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && bash scripts/apply-pending-migrations.sh"; then
  error "Migrations failed. Deploy aborted before starting the new api/web containers."
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: migrations failed"
  exit 1
fi
success "Migrations applied."

# ---------------------------------------------------------------------------
# Deploy: build + restart application services
# ---------------------------------------------------------------------------
info "[7/8] Building and deploying api + web + cert-api..."
info "Initializing cert-api persistent volume permissions..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && (docker compose -f ${COMPOSE_FILE} rm -f -s cert-volumes-init >/dev/null 2>&1 || true) && docker compose -f ${COMPOSE_FILE} run --rm --no-deps cert-volumes-init"; then
  error "cert-api volume initialization failed. Deploy aborted before restarting cert-api."
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: cert-api volume init failed"
  exit 1
fi
ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && \
  APP_VERSION='${LOCAL_SHA}' docker compose -f ${COMPOSE_FILE} up -d --no-deps --build api web cert-api"
success "Containers started."

# ---------------------------------------------------------------------------
# Health check loop
# ---------------------------------------------------------------------------
info "[8/8] Waiting for health check: ${HEALTH_ENDPOINT}"
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
      docker compose -f ${COMPOSE_FILE} up -d --no-deps --build api web cert-api" || true

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
ssh "${DEPLOY_USER}@${SERVER}" "docker exec importacao-cert-api python -c \"import json, urllib.request; data=json.load(urllib.request.urlopen('http://localhost:8000/api/ready', timeout=5)); raise SystemExit(0 if data.get('ready') is True else 1)\"" > /dev/null || {
  error "cert-api readiness check failed after deploy."
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: cert-api readiness failed"
  exit 1
}
success "cert-api readiness passed."
ssh "${DEPLOY_USER}@${SERVER}" "curl -sf '${WEB_HEALTH_ENDPOINT}'" > /dev/null || {
  error "web health check failed after deploy: ${WEB_HEALTH_ENDPOINT}"
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: web health failed"
  exit 1
}
success "web health passed."
if [[ -n "${PUBLIC_WEB_HEALTH_ENDPOINT}" ]]; then
  if ! curl -sf "${PUBLIC_WEB_HEALTH_ENDPOINT}" > /dev/null; then
    error "public web health check failed after deploy: ${PUBLIC_WEB_HEALTH_ENDPOINT}"
    notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: public web health failed"
    exit 1
  fi
  success "public web health passed."
fi
info "Refreshing observability services..."
ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && docker compose -f ${COMPOSE_FILE} up -d --no-deps prometheus alertmanager grafana && docker compose -f ${COMPOSE_FILE} restart prometheus alertmanager" > /dev/null || \
  warn "Could not refresh observability services — verify Prometheus/Alertmanager manually."
ssh "${DEPLOY_USER}@${SERVER}" "printf '%s\n' '${LOCAL_SHA}' > ${DEPLOY_DIR}/REVISION" 2>/dev/null || \
  warn "Could not write ${DEPLOY_DIR}/REVISION"

# Deploy succeeded — drop the rollback snapshot to reclaim space.
if [[ "${ROLLBACK_READY}" -eq 1 ]]; then
  ssh "${DEPLOY_USER}@${SERVER}" "rm -rf ${ROLLBACK_DIR}" 2>/dev/null || \
    warn "Could not remove rollback snapshot ${ROLLBACK_DIR} — remove it manually."
fi

# ---------------------------------------------------------------------------
# Final status
# ---------------------------------------------------------------------------
info "Deployment status:"
ssh "${DEPLOY_USER}@${SERVER}" "docker ps --filter name=importacao --format 'table {{.Names}}\t{{.Status}}'"

echo ""
success "=== Deploy completed successfully ==="
success "SHA: ${LOCAL_SHA:0:12} deployed to ${SERVER}"
notify "SUCCESS" "Deployed ${LOCAL_SHA:0:12} to ${SERVER}"

# ---------------------------------------------------------------------------
# Migration reminder
# ---------------------------------------------------------------------------
cat << 'MIGRATIONS_NOTE'

NOTE: migrations já rodam automaticamente no passo [6/8]. O manual abaixo
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
  AI_PROVIDER=ialocal
  AI_ALLOW_EXTERNAL=false                         # set true only for explicit external-provider opt-in
  AI_USE_SPECIALIST=1
  IA_LOCAL_BASE_URL=http://ia-local-gateway:8443/v1
  IA_LOCAL_API_KEY=<gateway-token>
  IA_LOCAL_MODEL=unico-docintel
  IA_LOCAL_EMBED_MODEL=bge-m3
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
