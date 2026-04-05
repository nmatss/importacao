# TLS / HTTPS Setup

## Overview

Production uses Let's Encrypt via Certbot. The `docker-compose.prod.yml` includes a `certbot`
service, and `infra/nginx/prod.conf` provides the HTTPS Nginx configuration with HSTS preload.

## Prerequisites

- Domain A record pointing to server IP
- Ports 80 and 443 open in firewall
- Docker Compose v2

## Initial Certificate Issuance

```bash
export DOMAIN=importacao.grupounico.com

# 1. Start web service (for ACME challenge)
docker compose -f docker-compose.prod.yml up -d web

# 2. Issue certificate
docker compose -f docker-compose.prod.yml run --rm certbot \
  certbot certonly \
  --webroot -w /var/www/certbot \
  --email admin@grupounico.com \
  --agree-tos --no-eff-email \
  -d ${DOMAIN}

# 3. Activate TLS nginx config (replace env var in template)
envsubst '$DOMAIN' < infra/nginx/prod.conf \
  | docker exec -i importacao-web sh -c 'cat > /etc/nginx/conf.d/default.conf'
docker compose -f docker-compose.prod.yml exec web nginx -s reload

# 4. Verify
curl -I https://${DOMAIN}
```

## Auto-Renewal

```cron
# Run twice daily (Let's Encrypt recommendation)
0 */12 * * * /home/nicolas/importacao/scripts/renew-certs.sh >> /var/log/importacao-certs.log 2>&1
```

## HSTS Preload

`prod.conf` includes: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

**Warning**: Only enable after verifying HTTPS works on ALL subdomains. Submit to preload list at hstspreload.org.

## Certificate Paths (in container)

| File | Path |
|------|------|
| Certificate + chain | `/etc/letsencrypt/live/${DOMAIN}/fullchain.pem` |
| Private key | `/etc/letsencrypt/live/${DOMAIN}/privkey.pem` |
| Docker volume | `letsencrypt` (persisted across restarts) |

## Troubleshooting

```bash
# Check certificate status
docker compose -f docker-compose.prod.yml run --rm certbot certbot certificates

# Test renewal (dry run)
docker compose -f docker-compose.prod.yml run --rm certbot certbot renew --dry-run

# View nginx logs
docker logs importacao-web
```
