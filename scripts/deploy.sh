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
#   PROXY_HEALTH_ENDPOINT /api atraves do nginx, como o browser (default: http://localhost:8085/api/health)
#   PUBLIC_WEB_HEALTH_ENDPOINT Optional public HTTPS/frontend URL to validate
#   ALLOW_SYDLE_SYNC_DEPLOY Set to "1" to allow SYDLE_SYNC_ENABLED=true after UAT
#   EXPECTED_LINX_WRITE_ENABLED Expected effective flag (default: false); true requires explicit authorization
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
# Passa pelo nginx, como o browser: valida o proxy /api, nao so a api direta.
PROXY_HEALTH_ENDPOINT="${PROXY_HEALTH_ENDPOINT:-http://localhost:8085/api/health}"
PUBLIC_WEB_HEALTH_ENDPOINT="${PUBLIC_WEB_HEALTH_ENDPOINT:-}"
ALLOW_SYDLE_SYNC_DEPLOY="${ALLOW_SYDLE_SYNC_DEPLOY:-0}"
EXPECTED_LINX_WRITE_ENABLED="${EXPECTED_LINX_WRITE_ENABLED:-false}"
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
if [[ "${EXPECTED_LINX_WRITE_ENABLED}" != "false" && "${EXPECTED_LINX_WRITE_ENABLED}" != "true" ]]; then
  error "EXPECTED_LINX_WRITE_ENABLED must be false or true. Review the authorized Linx write setting."
  exit 1
fi

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
REMOTE_DIR_STATUS=0
ssh "${DEPLOY_USER}@${SERVER}" "test -d ${DEPLOY_DIR}" || REMOTE_DIR_STATUS=$?
if [[ "${REMOTE_DIR_STATUS}" == "0" ]]; then
  # Build a complete candidate snapshot before replacing the previous rollback.
  # cp -al may leave a partial directory on failure; never copy into that directory.
  if ssh "${DEPLOY_USER}@${SERVER}" "stage=\"${ROLLBACK_DIR}.pending-${LOCAL_SHA:0:12}\"; rm -rf \"\$stage\"; if ! cp -al ${DEPLOY_DIR} \"\$stage\" 2>/dev/null; then rm -rf \"\$stage\" && cp -a ${DEPLOY_DIR} \"\$stage\" || exit 1; fi; test -f \"\$stage/${COMPOSE_FILE}\" && rm -rf ${ROLLBACK_DIR} && mv \"\$stage\" ${ROLLBACK_DIR}"; then
    ROLLBACK_READY=1
    success "Snapshot ready (previous release preserved)."
  else
    error "Could not snapshot current release. Deploy aborted before code sync."
    exit 1
  fi
elif [[ "${REMOTE_DIR_STATUS}" == "1" && "${ALLOW_FIRST_DEPLOY:-0}" == "1" ]]; then
  warn "Explicit first deployment: no previous release snapshot."
else
  error "Cannot verify previous release directory (status ${REMOTE_DIR_STATUS}); deploy aborted."
  exit 1
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
  --exclude '.context' \
  --exclude '.playwright-cli' \
  --exclude '.pytest_cache' \
  --exclude '.ruff_cache' \
  --exclude '__pycache__' \
  --exclude '.venv' \
  --exclude 'coverage' \
  --exclude 'output' \
  --exclude 'playwright-report' \
  --exclude 'test-results' \
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

info "Checking effective Linx write flag after SOPS generation..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && python3 - '${COMPOSE_FILE}' '${EXPECTED_LINX_WRITE_ENABLED}'" <<'LINX_PY'
import json
import subprocess
import sys

try:
    result = subprocess.run(
        ["docker", "compose", "-f", sys.argv[1], "config", "--format", "json"],
        capture_output=True, text=True, timeout=60, check=True,
    )
    # Compose contains credentials: parse in memory, never print its output or errors.
    config = json.loads(result.stdout)
    value = config["services"]["cert-api"]["environment"]["LINX_WRITE_ENABLED"]
    if not isinstance(value, str) or value not in ("true", "false"):
        raise ValueError("Unexpected Linx flag format")
    if value != sys.argv[2]:
        print("Linx write flag differs from the authorized release expectation.", file=sys.stderr)
        sys.exit(1)
except Exception:
    print("Cannot verify the effective Linx write flag; deployment blocked.", file=sys.stderr)
    sys.exit(1)
print("Effective Linx write flag matches the release expectation.")
LINX_PY
then
  error "Linx write verification failed. Review the SOPS/Compose flag and explicit write authorization before deploying."
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
      error "SYDLE_SYNC_ENABLED=true in remote .env. Deploy blocked until the real SYDLE rollout is explicitly approved for this release."
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
import os
import stat
import tempfile

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
# Atomic replacement keeps the hardlinked rollback snapshot unchanged.
fd, temporary = tempfile.mkstemp(prefix=".alertmanager-", dir=target.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(template.read_text(encoding="utf-8").replace("${ALERTMANAGER_WEBHOOK_URL}", yaml_url))
    os.chmod(temporary, stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o644)
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
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
# Build before any schema mutation: failed compilation must not advance the DB.
info "Building release images before applying migrations..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && APP_VERSION='${LOCAL_SHA}' docker compose -f ${COMPOSE_FILE} build api web cert-api"; then
  error "Release image build failed. Existing containers were not restarted."
  exit 1
fi

info "[6/8] Applying pending SQL migrations..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && bash scripts/apply-pending-migrations.sh"; then
  error "Migrations failed. Deploy aborted before starting the new api/web containers."
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: migrations failed"
  exit 1
fi
info "Applying explicit certification migrations with the new release image..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && docker compose -f ${COMPOSE_FILE} run --rm --no-deps cert-api python -m app.db.release_migrations --apply"; then
  error "Certification migrations failed. Deploy aborted before restarting applications."
  exit 1
fi
success "API and certification migrations applied and checked."

# ---------------------------------------------------------------------------
# Deploy: build + restart application services
# ---------------------------------------------------------------------------
info "[7/8] Building and deploying api + web + cert-api..."

# Preserva o log dos containers ANTES de recria-los.
#
# `up -d --build` recria api/web/cert-api e o `docker logs` do container antigo
# vai junto. Isso ja atrapalhou investigacao duas vezes em 17/08/2026 — a
# janela do problema de login da Odett e a das falhas de extracao ficaram sem
# evidencia porque o container tinha sido recriado. Como `audit_logs` so
# registrava login bem-sucedido, o log do container era a unica trilha fina.
#
# Nao pode abortar deploy: e captura de evidencia, nao gate de qualidade.
LOG_ARCHIVE_DIR="/home/${DEPLOY_USER}/backups/importacao/logs"
LOG_STAMP="$(date +%Y-%m-%d_%H%M%S)"
info "Arquivando log dos containers antes da recriacao..."
ssh "${DEPLOY_USER}@${SERVER}" "mkdir -p ${LOG_ARCHIVE_DIR} && \
  for c in importacao-api importacao-web importacao-cert-api; do \
    docker logs --timestamps \"\$c\" > ${LOG_ARCHIVE_DIR}/\${c}_${LOG_STAMP}.log 2>&1 || true; \
    gzip -f ${LOG_ARCHIVE_DIR}/\${c}_${LOG_STAMP}.log || true; \
  done; \
  find ${LOG_ARCHIVE_DIR} -name '*.log.gz' -mtime +30 -delete 2>/dev/null || true" \
  && success "Log arquivado em ${LOG_ARCHIVE_DIR} (retencao 30 dias)." \
  || warn "Nao foi possivel arquivar o log dos containers; seguindo com o deploy."

info "Initializing cert-api persistent volume permissions..."
if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && (docker compose -f ${COMPOSE_FILE} rm -f -s cert-volumes-init >/dev/null 2>&1 || true) && docker compose -f ${COMPOSE_FILE} run --rm --no-deps cert-volumes-init"; then
  error "cert-api volume initialization failed. Deploy aborted before restarting cert-api."
  notify "FAIL" "Deploy ${LOCAL_SHA:0:12}: cert-api volume init failed"
  exit 1
fi
# Check all application boundaries, including the browser proxy, before success.
release_ready() {
  ssh "${DEPLOY_USER}@${SERVER}" "curl --connect-timeout 5 --max-time 10 -sf '${HEALTH_ENDPOINT}'" >/dev/null 2>&1 &&
  ssh "${DEPLOY_USER}@${SERVER}" "docker exec importacao-cert-api python -c \"import json, urllib.request; data=json.load(urllib.request.urlopen('http://localhost:8000/api/ready', timeout=5)); raise SystemExit(0 if data.get('ready') is True else 1)\"" >/dev/null 2>&1 &&
  ssh "${DEPLOY_USER}@${SERVER}" "curl --connect-timeout 5 --max-time 10 -sf '${WEB_HEALTH_ENDPOINT}'" >/dev/null 2>&1 &&
  ssh "${DEPLOY_USER}@${SERVER}" "curl --connect-timeout 5 --max-time 10 -sf '${PROXY_HEALTH_ENDPOINT}'" >/dev/null 2>&1 &&
  { [[ -z "${PUBLIC_WEB_HEALTH_ENDPOINT}" ]] || curl --connect-timeout 5 --max-time 10 -sf "${PUBLIC_WEB_HEALTH_ENDPOINT}" >/dev/null 2>&1; }
}

wait_release_ready() {
  local attempt
  for ((attempt=1; attempt<=HEALTH_RETRIES; attempt++)); do
    if release_ready; then return 0; fi
    info "Application readiness ${attempt}/${HEALTH_RETRIES} not ready yet..."
    sleep "${HEALTH_INTERVAL}"
  done
  return 1
}

rollback_release() {
  error "Release failed; restoring previous code and checking all application boundaries."
  if [[ "${ROLLBACK_READY}" != "1" ]]; then
    error "No previous release snapshot available; manual intervention required."
    return 1
  fi
  # Environment and live uploaded data must not be replaced by a stale snapshot.
  if ! ssh "${DEPLOY_USER}@${SERVER}" "rsync -a --delete --exclude '.env' --exclude 'uploads' --exclude 'reports/' --exclude 'logs' ${ROLLBACK_DIR}/ ${DEPLOY_DIR}/"; then
    error "Snapshot restore failed; manual intervention required."
    return 1
  fi
  if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && docker compose -f ${COMPOSE_FILE} up -d --no-deps --build api web cert-api"; then
    error "Previous release restart failed; manual intervention required."
    return 1
  fi
  if wait_release_ready; then
    warn "Previous code restored and all application checks passed. Database migrations were NOT rolled back."
    return 0
  fi
  error "Previous release restored but readiness failed; manual intervention required."
  return 1
}

if ! ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && APP_VERSION='${LOCAL_SHA}' docker compose -f ${COMPOSE_FILE} up -d --no-deps api web cert-api"; then
  rollback_release || true
  exit 1
fi
success "Containers started."

info "[8/8] Waiting for API, certification, web and proxy readiness..."
if ! wait_release_ready; then
  rollback_release || true
  exit 1
fi
success "All application readiness checks passed."

info "Refreshing observability services..."
ssh "${DEPLOY_USER}@${SERVER}" "cd ${DEPLOY_DIR} && docker compose -f ${COMPOSE_FILE} up -d --no-deps prometheus alertmanager grafana && docker compose -f ${COMPOSE_FILE} restart prometheus alertmanager" > /dev/null || \
  warn "Could not refresh observability services — verify Prometheus/Alertmanager manually."
ssh "${DEPLOY_USER}@${SERVER}" "printf '%s\n' '${LOCAL_SHA}' > ${DEPLOY_DIR}/REVISION" 2>/dev/null || \
  warn "Could not write ${DEPLOY_DIR}/REVISION"

# Keep the previous release for the initial monitoring/rollback window.
# The next deploy replaces it only after that deploy has its mandatory backup.
if [[ "${ROLLBACK_READY}" -eq 1 ]]; then
  info "Previous release retained at ${ROLLBACK_DIR}; database migrations remain forward-only."
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

  # 0022 (ALTER TYPE + ADD COLUMN — DUIMP, corpo de e-mail, observação urgente e registro aduaneiro)
  docker cp apps/api/drizzle/0022_odett_operational_feedback.sql importacao-postgres:/tmp/
  docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0022_odett_operational_feedback.sql

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
  COMMUNICATION_DEFAULT_CC=global@grupounico.com
  AUTO_GENERATE_ESPELHO=1
  AUTO_CLEAN_ITEM_CODES=1
  # Pasta criada em 2026-06-11 na área de importação do Drive ("Pre-Cons (sync
  # portal importação)"); compartilhar com a SA n8n-automacao@n8n-grupo-unico
  GOOGLE_DRIVE_PRE_CONS_FOLDER_ID=1OJmEV1GTI7vC0B-Uxb-btgQRMDu0530B
  # Vertex-only (leave blank until you wire it):
  # GOOGLE_VERTEX_PROJECT=
  # GOOGLE_VERTEX_LOCATION=us-central1

MIGRATIONS_NOTE
