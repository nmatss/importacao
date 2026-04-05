# Disaster Recovery (DR)

## RPO and RTO

| Metric | Target | Notes |
|--------|--------|-------|
| RPO | 24h | Daily backup at 02:00. Max 24h data loss. |
| RTO | 2h | Time to restore from backup to live service. |

To improve RPO to <1h: enable WAL streaming with pg_basebackup or Barman.

## Backup Storage

- **Local**: `/backups/importacao/` on production server (7-day retention)
- **Remote**: configured via `BACKUP_REMOTE_HOST`/`BACKUP_REMOTE_PATH` or `BACKUP_S3_BUCKET`
- **Format**: PostgreSQL custom format (`.pgdump`) — compressed, parallel-restore capable
- **Volumes**: `uploads/` and `cert-reports/` archived as `.tar.gz`

## Cron Schedule

```cron
# Daily backup at 02:00
0 2 * * * /home/nicolas/importacao/scripts/backup-db.sh >> /var/log/importacao-backup.log 2>&1

# Weekly restore test on Sunday at 03:00
0 3 * * 0 /home/nicolas/importacao/scripts/restore-test.sh >> /var/log/importacao-restore-test.log 2>&1
```

## Restore Procedure

### Step 1 — Identify latest backup

```bash
ls -lth /backups/importacao/*.pgdump | head -5
BACKUP=/backups/importacao/importacao_2026-04-05_020001.pgdump
```

### Step 2 — Stop application services

```bash
cd ~/importacao
docker compose -f docker-compose.prod.yml stop api cert-api web
```

### Step 3 — Drop and recreate database

```bash
docker exec importacao-postgres psql -U importacao -c "DROP DATABASE importacao;" postgres
docker exec importacao-postgres psql -U importacao -c "CREATE DATABASE importacao;" postgres
```

### Step 4 — Restore database

```bash
docker exec -i importacao-postgres \
  pg_restore -U importacao -d importacao --no-owner --no-acl \
  < "${BACKUP}"
```

### Step 5 — Restore volumes (if needed)

```bash
# Uploads
tar -xzf /backups/importacao/*_uploads.tar.gz \
  -C /var/lib/docker/volumes/importacao_uploads/_data --strip-components=1

# Cert-reports
tar -xzf /backups/importacao/*_cert-reports.tar.gz \
  -C /var/lib/docker/volumes/importacao_cert-reports/_data --strip-components=1
```

### Step 6 — Restart and verify

```bash
docker compose -f docker-compose.prod.yml up -d api cert-api web
curl -f http://localhost:3050/health/ready
```

## Full Server Failure Restore

1. Provision new server (Ubuntu 22+, Docker, git)
2. `git clone https://github.com/nmatss/importacao.git`
3. Restore `.env` from SOPS vault or backup
4. Transfer backups from remote storage
5. Follow steps 2–6 above
6. Update DNS / reverse proxy to new server IP

## Contacts

- Server: 192.168.168.124 (hostname: n8n), user: nicolas
- GitHub: https://github.com/nmatss/importacao
