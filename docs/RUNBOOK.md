# Runbook — Importacao Platform

Production server: `192.168.168.124` (hostname: n8n), user: `nicolas`

---

## Troubleshooting

### API not responding

```bash
# Check container status
ssh nicolas@192.168.168.124 "cd ~/importacao && docker compose ps"

# View recent API logs
ssh nicolas@192.168.168.124 "docker compose logs --tail=50 api"

# Restart API service
ssh nicolas@192.168.168.124 "cd ~/importacao && docker compose restart api"
```

Common causes:
- OOM killed: check `docker stats` or `dmesg | grep oom`
- Port conflict: verify `127.0.0.1:3050` is not in use by another process
- DB connection pool exhausted: check `cert_products` query count in postgres

### Database connection refused

```bash
# Check postgres container
ssh nicolas@192.168.168.124 "docker compose logs --tail=30 postgres"

# Connect manually
ssh nicolas@192.168.168.124 "docker compose exec postgres psql -U postgres -d importacao -c '\l'"

# Restart postgres (data is persisted in volume)
ssh nicolas@192.168.168.124 "cd ~/importacao && docker compose restart postgres"
```

If postgres won't start, check disk space:
```bash
ssh nicolas@192.168.168.124 "df -h"
```

### Gemini / AI timeout

The AI extraction uses Google AI Studio with a 90s timeout. If it times out:
1. Check the `.env` for `GEMINI_API_KEY` validity.
2. Try a smaller document (AI extraction may fail on very large PDFs).
3. The feature degrades gracefully — manual data entry still works.

### Deploy failed

```bash
# Run deploy manually and capture output
ssh nicolas@192.168.168.124 "bash ~/importacao/scripts/deploy.sh 2>&1 | tee /tmp/deploy.log"
cat /tmp/deploy.log

# Common fix: stale lockfile
ssh nicolas@192.168.168.124 "cd ~/importacao && docker compose down && docker compose up -d"
```

### Cert-API not responding

```bash
ssh nicolas@192.168.168.124 "docker compose logs --tail=50 cert-api"
ssh nicolas@192.168.168.124 "cd ~/importacao && docker compose restart cert-api"
```

Oracle WMS connection issues are non-fatal — cert-api starts even if WMS is unreachable.

---

## Rollback Manual

```bash
# Check recent git tags/commits
ssh nicolas@192.168.168.124 "cd ~/importacao && git log --oneline -10"

# Roll back to previous commit
ssh nicolas@192.168.168.124 "cd ~/importacao && git checkout <commit_hash>"
ssh nicolas@192.168.168.124 "cd ~/importacao && docker compose build && docker compose up -d"
```

To roll back only the API without rebuilding everything:
```bash
ssh nicolas@192.168.168.124 "cd ~/importacao && git checkout <commit_hash> -- apps/api/"
ssh nicolas@192.168.168.124 "cd ~/importacao && docker compose build api && docker compose restart api"
```

---

## Backup e Restore

### Create a backup

```bash
ssh nicolas@192.168.168.124 "docker compose exec postgres pg_dump -U postgres importacao | gzip > /tmp/backup_$(date +%Y%m%d).sql.gz"
scp nicolas@192.168.168.124:/tmp/backup_$(date +%Y%m%d).sql.gz ./backups/
```

### Restore from backup

```bash
scp ./backups/backup_20260101.sql.gz nicolas@192.168.168.124:/tmp/
ssh nicolas@192.168.168.124 "gunzip -c /tmp/backup_20260101.sql.gz | docker compose exec -T postgres psql -U postgres importacao"
```

---

## Reset JWT_SECRET

**Warning**: Resetting `JWT_SECRET` immediately invalidates ALL active user sessions. All users will be logged out.

If you must rotate:
1. Generate a new secret: `openssl rand -base64 48`
2. Update `JWT_SECRET` in the `.env` file on the server.
3. Restart the API: `docker compose restart api`
4. Notify users that they will need to log in again.

There is no way to rotate JWT_SECRET without invalidating existing tokens unless you implement token versioning (not currently implemented).

---

## Contacts — Critical Incidents

| Incident | Contact |
|----------|---------|
| Production server down | Nicolas Matsuda (admin) |
| Database corruption | Nicolas Matsuda |
| Oracle WMS unreachable | TI Grupo Unico |
| Google API quota exceeded | Nicolas Matsuda (check Google Cloud Console) |
| Email delivery failure | TI (check mta.imgnet.com.br relay) |
