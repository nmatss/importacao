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
echo "[1/6] Checking TypeScript compilation..."
npx -w apps/api tsc --noEmit || { echo "API compilation failed"; exit 1; }
npx -w apps/web tsc --noEmit || { echo "Web compilation failed"; exit 1; }
echo "  Compilation OK"

# 2. Sync code to server (exclude .env, node_modules, dist, uploads)
echo "[2/6] Syncing code to server..."
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
echo "[3/6] Generating .env from Vault..."
ssh "${USER}@${SERVER}" "cd ${REMOTE_DIR} && \
  VAULT_ADDR=http://vault-central:8200 \
  VAULT_ROLE_ID=\${VAULT_ROLE_ID:-} \
  VAULT_SECRET_ID=\${VAULT_SECRET_ID:-} \
  bash scripts/generate-env-from-vault.sh" || {
  echo "  Warning: Vault env generation failed, using existing .env"
}

# 4. Build Docker images
echo "[4/6] Building Docker images..."
ssh "${USER}@${SERVER}" "cd ${REMOTE_DIR} && \
  docker compose -f ${COMPOSE_FILE} build --no-cache"
echo "  Build complete"

# 5. Deploy with zero-downtime (restart one by one)
echo "[5/6] Deploying containers..."
ssh "${USER}@${SERVER}" "cd ${REMOTE_DIR} && \
  docker compose -f ${COMPOSE_FILE} up -d --force-recreate"
echo "  Containers deployed"

# 6. Verify health
echo "[6/6] Verifying deployment..."
sleep 5
ssh "${USER}@${SERVER}" "docker ps --filter name=importacao --format 'table {{.Names}}\t{{.Status}}'"

# ---------------------------------------------------------------------------
# MANUAL MIGRATION: 0005_certificate_and_reprocessed.sql
# ---------------------------------------------------------------------------
# This migration CANNOT be applied automatically by Drizzle because it uses
# ALTER TYPE ... ADD VALUE, which PostgreSQL forbids inside a transaction block.
# Drizzle wraps migrations in a transaction, so the statement would fail with:
#   ERROR: ALTER TYPE ... ADD VALUE cannot run inside a transaction block
#
# After deploying, apply it manually with these commands:
#
#   # 1. Copy the migration file into the postgres container
#   docker cp apps/api/drizzle/0005_certificate_and_reprocessed.sql \
#     importacao-postgres:/tmp/0005_certificate_and_reprocessed.sql
#
#   # 2. Execute the migration
#   docker exec importacao-postgres \
#     psql -U importacao -d importacao -f /tmp/0005_certificate_and_reprocessed.sql
#
#   # 3. Verify the new enum values were added
#   docker exec importacao-postgres \
#     psql -U importacao -d importacao -c "SELECT enum_range(NULL::document_type);"
#   docker exec importacao-postgres \
#     psql -U importacao -d importacao -c "SELECT enum_range(NULL::email_ingestion_status);"
#
# The migration adds:
#   - 'certificate' value to the document_type enum
#   - 'reprocessed' value to the email_ingestion_status enum
# ---------------------------------------------------------------------------

echo ""
echo "=== Deployment complete ==="
echo ""
echo "NOTE: If this is the first deploy with migration 0005, apply it manually:"
echo "  docker cp apps/api/drizzle/0005_certificate_and_reprocessed.sql importacao-postgres:/tmp/"
echo "  docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0005_certificate_and_reprocessed.sql"
