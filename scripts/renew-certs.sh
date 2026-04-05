#!/usr/bin/env bash
# =============================================================================
# renew-certs.sh — Let's Encrypt certificate auto-renewal
# =============================================================================
# Recommended crontab (twice daily):
#   0 */12 * * * /home/nicolas/importacao/scripts/renew-certs.sh >> /var/log/importacao-certs.log 2>&1
# =============================================================================
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
WEBROOT="/var/www/certbot"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "Checking certificate renewal..."

docker compose -f "${COMPOSE_FILE}" run --rm certbot \
  certbot renew \
  --webroot -w "${WEBROOT}" \
  --non-interactive \
  --agree-tos \
  2>&1

log "Reloading Nginx..."
docker compose -f "${COMPOSE_FILE}" exec -T web nginx -s reload 2>&1 || {
  log "WARNING: nginx reload failed — may need manual restart"
}

log "Certificate renewal check complete."
