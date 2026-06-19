# TLS / HTTPS Setup

## Overview

The application container exposes the web service on `127.0.0.1:8085` for local
health checks and also joins the external Docker network `n8n_enterprise_web`.
Public HTTPS for `importacao.grupounico.com` is routed by the shared Traefik
container through Docker labels on the `web` service.

`docker-compose.prod.yml` still includes the `certbot` service behind the
optional `tls` profile for environments that issue certificates on the same
host, but the `web` container does not currently mount `letsencrypt` or
`certbot-webroot`. Do not assume the compose file alone activates HTTPS inside
the app container.

## Current Production Status - 2026-06-19

- The application is deployed internally on
  `3f36137a697fee9f4f1011bc3eace3417467d5be`.
- Internal web health is OK at `http://127.0.0.1:8085/`.
- The shared Traefik receives `Host: importacao.grupounico.com` over HTTP and
  redirects to HTTPS, but it does not have an ACME certificate for that SNI.
- Public `https://importacao.grupounico.com/` still returns `HTTP/2 502` from
  an external `nginx` layer.
- ACME logs showed the challenge being answered by another public IP/proxy with 404. Fix DNS/NAT/proxy ownership before declaring public go-live.

## Prerequisites

- Domain A record or edge proxy pointing 80/443 to the component that owns TLS.
  If Traefik owns TLS, ACME HTTP challenge paths must reach the Traefik
  container without interception.
- Ports 80 and 443 open in firewall
- Docker Compose v2

## External Reverse Proxy Path

```bash
export DOMAIN=importacao.grupounico.com

# 1. Deploy the app. It should listen locally and be attached to Traefik.
docker compose -f docker-compose.prod.yml up -d web
curl -I http://127.0.0.1:8085/

# 2. Confirm the shared Traefik network exists.
docker network inspect n8n_enterprise_web >/dev/null

# 3. Verify public HTTPS.
curl -I https://${DOMAIN}
```

When using `scripts/deploy.sh`, set `PUBLIC_WEB_HEALTH_ENDPOINT=https://importacao.grupounico.com/`
so the deploy validates the public HTTPS path after the container health checks.
Do this for final go-live validation; a deploy with only internal health checks
means the release is installed, not that public HTTPS is available.

## Optional Certbot Profile

Use this only if the host proxy is wired to the compose-managed
`letsencrypt`/`certbot-webroot` volumes. The current app `web` service does not
consume these volumes by itself.

```bash
export DOMAIN=importacao.grupounico.com

docker compose -f docker-compose.prod.yml --profile tls run --rm certbot \
  certbot certonly \
  --webroot -w /var/www/certbot \
  --email admin@grupounico.com \
  --agree-tos --no-eff-email \
  -d ${DOMAIN}
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

| File                | Path                                            |
| ------------------- | ----------------------------------------------- |
| Certificate + chain | `/etc/letsencrypt/live/${DOMAIN}/fullchain.pem` |
| Private key         | `/etc/letsencrypt/live/${DOMAIN}/privkey.pem`   |
| Docker volume       | `letsencrypt` (persisted across restarts)       |

## Troubleshooting

```bash
# Verify the app container directly on the production host
curl -I http://127.0.0.1:8085/

# Verify Traefik HTTP routing on the production host
curl -I -H 'Host: importacao.grupounico.com' http://127.0.0.1/

# Check whether Traefik has an ACME certificate entry without printing secrets
docker exec n8n-enterprise-traefik-1 sh -lc \
  "grep -o 'importacao.grupounico.com' /letsencrypt/acme.json | sort -u"

# Check certificate status
docker compose -f docker-compose.prod.yml run --rm certbot certbot certificates

# Test renewal (dry run)
docker compose -f docker-compose.prod.yml run --rm certbot certbot renew --dry-run

# View nginx logs
docker logs importacao-web
```
