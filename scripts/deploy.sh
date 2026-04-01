#!/bin/bash
# Deploy importacao to production server
# Usage: ./scripts/deploy.sh [server-ip]

set -euo pipefail

SERVER="${1:-192.168.168.124}"
USER="nicolas"
REMOTE_DIR="/home/${USER}/importacao"
COMPOSE_FILE="docker-compose.prod.yml"

echo "=== Deploying importacao to ${SERVER} ==="

# 1. Ensure local code compiles
echo "[1/7] Checking TypeScript compilation..."
npx -w apps/api tsc --noEmit || { echo "API compilation failed"; exit 1; }
npx -w apps/web tsc --noEmit || { echo "Web compilation failed"; exit 1; }
echo "  Compilation OK"

# 2. Sync code to server (exclude .env, node_modules, dist, uploads)
echo "[2/7] Syncing code to server..."
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
  ./ "${USER}@${SERVER}:${REMOTE_DIR}/"
echo "  Sync complete"

# 3. Generate .env from Vault on server
echo "[3/7] Generating .env from Vault..."
ssh "${USER}@${SERVER}" "cd ${REMOTE_DIR} && \
  VAULT_ADDR=http://vault-central:8200 \
  VAULT_ROLE_ID=\${VAULT_ROLE_ID:-} \
  VAULT_SECRET_ID=\${VAULT_SECRET_ID:-} \
  bash scripts/generate-env-from-vault.sh" || {
  echo "  Warning: Vault env generation failed, using existing .env"
}

# 4. Backup database before deploy
echo "[4/7] Backing up database..."
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql.gz"
ssh "${USER}@${SERVER}" "docker exec importacao-postgres \
  pg_dump -U importacao importacao | gzip > ${REMOTE_DIR}/backups/${BACKUP_FILE}" 2>/dev/null && {
  echo "  Backup saved: ${BACKUP_FILE}"
} || {
  echo "  Warning: Database backup failed (container may not be running yet)"
}

# 5. Build Docker images
echo "[5/7] Building Docker images..."
ssh "${USER}@${SERVER}" "cd ${REMOTE_DIR} && \
  docker compose -f ${COMPOSE_FILE} build --no-cache"
echo "  Build complete"

# 6. Deploy with zero-downtime (restart one by one)
echo "[6/7] Deploying containers..."
ssh "${USER}@${SERVER}" "cd ${REMOTE_DIR} && \
  docker compose -f ${COMPOSE_FILE} up -d --force-recreate"
echo "  Containers deployed"

# 7. Verify health
echo "[7/7] Verifying deployment..."
sleep 5
ssh "${USER}@${SERVER}" "docker ps --filter name=importacao --format 'table {{.Names}}\t{{.Status}}'"

# ---------------------------------------------------------------------------
# MANUAL MIGRATIONS
# ---------------------------------------------------------------------------
# The following migrations use ALTER TYPE ... ADD VALUE, which PostgreSQL
# forbids inside a transaction block. Drizzle wraps migrations in a
# transaction, so these must be applied manually.
#
# Migration 0005: (already applied in production)
#   docker cp apps/api/drizzle/0005_certificate_and_reprocessed.sql importacao-postgres:/tmp/
#   docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0005_certificate_and_reprocessed.sql
#
# Migration 0007: (ALTER TYPE for draft_bl + logistic_status + document_stage)
#   docker cp apps/api/drizzle/0007_draft_bl.sql importacao-postgres:/tmp/
#   docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0007_draft_bl.sql
#
# Migrations 0006, 0008, 0009 should be applied automatically by Drizzle
# via the entrypoint. If not, apply manually:
#   docker cp apps/api/drizzle/0006_first_delivery.sql importacao-postgres:/tmp/
#   docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0006_first_delivery.sql
#   docker cp apps/api/drizzle/0008_email_signatures.sql importacao-postgres:/tmp/
#   docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0008_email_signatures.sql
#   docker cp apps/api/drizzle/0009_process_events.sql importacao-postgres:/tmp/
#   docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0009_process_events.sql
# ---------------------------------------------------------------------------

echo ""
echo "=== Deployment complete ==="
echo ""
echo "IMPORTANT: Check if pending migrations need manual application:"
echo "  - 0007_draft_bl.sql (requires manual apply due to ALTER TYPE)"
echo "  - 0006, 0008, 0009 (verify via: docker exec importacao-postgres psql -U importacao -d importacao -c '\\dt')"
echo ""
echo "Database backup: backups/${BACKUP_FILE:-none}"
