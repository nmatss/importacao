# RUNBOOK.md — Operational Playbook

> Companion to `DEPLOY.md`. Grounded in: `apps/api/src/modules/health/routes.ts`,
> `apps/cert-api/app/routes/health.py`, `apps/api/src/modules/settings/routes.ts` +
> `controller.ts` + `operational-recipients.ts`, `apps/api/src/modules/validation/routes.ts`
> (+ `apps/api/src/routes.ts` mount), `apps/api/src/shared/config/env.ts`,
> `apps/cert-api/app/services/erp_service.py`, `apps/cert-api/entrypoint.sh`,
> `scripts/backup-db.sh`, `scripts/restore-test.sh`, `scripts/deploy.sh`,
> `docker-compose.prod.yml`. Issue refs `#60/#78/#85` from repo tracking.

All commands run on the production host (`nicolas@<server>`, default `192.168.168.124`),
in `~/importacao`, with `docker-compose.prod.yml`.

---

## 1. Health & readiness

### api (Express)
- `GET /health/live` — liveness; 200 if the process is up.
- `GET /health/ready` — readiness; checks **DB + Redis**. Returns 200 `{status:"ok", checks:{db,redis}}`
  or **503** `{status:"degraded"}` if a dependency is down.
- Externally on the host: `curl -sf http://localhost:3050/health/ready` (this is what `deploy.sh` polls).

### cert-api (FastAPI)
- `GET /api/health` — liveness + `database`, `sheets_configured`, `vtex_stores`.
- `GET /api/ready` — `{ready:true}` or `{ready:false, reason:...}` (verifies DB).
- Internal only — exec into the container:
  ```
  docker exec importacao-cert-api python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/api/ready').read())"
  ```

### Quick status
```
docker ps --filter name=importacao --format 'table {{.Names}}\t{{.Status}}'
docker compose -f docker-compose.prod.yml logs --tail=100 api
cat ~/importacao/REVISION    # deployed SHA
```
Container healthchecks (compose): api every 10s (db+redis), cert-api `/api/ready` every 30s,
web `curl /` every 30s, postgres `pg_isready`, redis `redis-cli ping`.

---

## 2. Common operations

### 2.1 Configure operational email recipients
Two layers (DB overrides env — `operational-recipients.ts`):
- **Preferred (UI):** *Configurações > Destinatários operacionais* → persists `kiom_email`,
  `fenicia_email`, `isa_email` in the DB via `PUT /api/settings/recipients`
  (`GET /api/settings/recipients` to read).
- **Fallback (env):** `KIOM_EMAIL` / `FENICIA_EMAIL` / `ISA_EMAIL` (CSV supported) in `.env`,
  then restart api. Used only when the DB value is empty.
- Extra allowlist: `COMMUNICATION_ALLOWED_RECIPIENTS` (exact emails or domains). KIOM/FENICIA/ISA auto-allowed.

### 2.2 Switch extraction provider (ialocal ⇄ vertex)
Provider is `AI_PROVIDER` (validated in `shared/config/env.ts`). Default `ialocal`.
- To **vertex**: set `AI_PROVIDER=vertex`, `AI_ALLOW_EXTERNAL=true` (required for any external provider,
  else startup validation fails), and `GOOGLE_VERTEX_PROJECT` / `GOOGLE_VERTEX_LOCATION` /
  `GOOGLE_VERTEX_CLIENT_EMAIL` / `GOOGLE_VERTEX_PRIVATE_KEY`. **Blocked until IAM #60 is fixed**
  (`roles/aiplatform.user` + enable `aiplatform.googleapis.com`).
- To **ialocal**: `AI_PROVIDER=ialocal`, `AI_ALLOW_EXTERNAL=false`, ensure `IA_LOCAL_BASE_URL` /
  `IA_LOCAL_API_KEY` set and the api container is on `ia-local-net`.
- Apply: edit `.env` (or re-run SOPS gen), then
  `docker compose -f docker-compose.prod.yml up -d --no-deps api`.

### 2.3 Trigger / schedule certification revalidation
- Validation runs **per process**: `POST /api/validation/:processId/run` (rate-limited).
  Read results `GET /api/validation/:processId`, report `GET /api/validation/:processId/report`.
  (There is no global `POST /api/validate`; it is per-process under `/api/validation`.)
- cert-api license map auto-refreshes via a short-TTL cache (see §3c).
- **Scheduling:** drive periodic revalidation with cron on the host calling the per-process
  endpoint, e.g.:
  ```
  # re-run validation for an active process every 6h
  0 */6 * * * curl -sf -X POST http://localhost:3050/api/validation/<PROCESS_ID>/run >/dev/null 2>&1
  ```

---

## 3. Troubleshooting (known user-facing symptoms)

### (a) "Email send blocked" / "Destinatário não autorizado" — #78
**Cause:** no operational recipient configured (neither DB nor env), or recipient not in the allowlist.
**Fix:**
1. Set recipients in *Configurações > Destinatários operacionais* (preferred) OR set
   `KIOM_EMAIL`/`FENICIA_EMAIL`/`ISA_EMAIL` in `.env` and restart api.
2. For ad-hoc partners, add their email/domain to `COMMUNICATION_ALLOWED_RECIPIENTS`.
3. Verify SMTP is configured (`SMTP_HOST/PORT/USER/PASS/FROM`) — a missing recipient and a missing
   SMTP relay are different failures; check api logs.

### (b) Extraction renders empty fields
**Cause:** the default on-prem model (`AI_PROVIDER=ialocal`, `unico-docintel`) is a weak local model;
cross-checking fields come back null on hard documents. (Stalls beyond
`DOCUMENT_PROCESSING_STALE_MINUTES`/`DOCUMENT_AI_EXTRACTION_TIMEOUT_MS` surface as explicit errors.)
**Fix / mitigation:**
1. Confirm the IA_LOCAL gateway is reachable (api on `ia-local-net`, `IA_LOCAL_BASE_URL`/`API_KEY` valid).
2. Re-run with **real** documents (not low-quality scans).
3. For higher accuracy, switch to **Vertex** (§2.2) once **IAM #60** is resolved.
4. Check api logs for timeout/budget messages.

### (c) Certification list slow OR licenses all `NAO_APLICAVEL`
**Cause:** Google Sheets quota / **429** when fetching the Licenciamentos Vencidos map.
**Mitigation (already in place):** `erp_service.get_license_map_cached` keeps a short-TTL cache
(`LICENSE_MAP_TTL_SECONDS = 120s`) and serves the last good map on a Sheets error within/after TTL —
so a browsing/pagination session reuses one fetch.
**Steps:**
1. Check cert-api logs for Sheets 429/quota errors.
2. Confirm the TTL cache is serving (repeated list calls should not re-hit Sheets within 120s).
3. If persistently 429, raise the Sheets API quota or widen the TTL; verify the SA still has Viewer
   access to the spreadsheet (`GOOGLE_SHEETS_SPREADSHEET_ID`).

### (d) cert-api HTTP 500 on report export — #85 (volume perms)
**Cause:** fresh/recreated named volume owned `root:root` → cert-api (uid 1001) can't write `/app/reports`.
**Now durable:** `apps/cert-api/entrypoint.sh` chowns `/app/reports` + `/app/certs` on every start, then
drops to uid 1001 via gosu. **No manual chown needed.**
**If it still 500s:**
1. `docker compose -f docker-compose.prod.yml up -d --build cert-api` (re-runs the entrypoint chown).
2. Verify ownership: `docker exec importacao-cert-api ls -ln /app/reports /app/certs` (should be `1001:1001`).
3. Confirm volumes `cert-reports` / `cert-certs` exist (`docker volume ls | grep cert`).

### (e) Espelho / proforma tab crash
**Status:** the espelho/proforma tab rendering is now guarded against the crash. If a crash recurs,
capture the browser console error and the failing process ID, and check api logs for the espelho/proforma
endpoints.

---

## 4. Backup / restore

### Backup (automatic + manual)
- `deploy.sh` runs a **mandatory** pre-deploy backup (`backup-db.sh --remote`).
- Recommended cron (from `backup-db.sh` header): `0 2 * * * ~/importacao/scripts/backup-db.sh >> /var/log/importacao-backup.log 2>&1`.
- What it produces (default `BACKUP_LOCAL_DIR=$HOME/backups/importacao` in remote mode):
  - `importacao_<ts>.pgdump` — `pg_dump -Fc --no-owner --no-acl` (custom format), integrity-checked with `pg_restore --list`.
  - `importacao_<ts>_uploads.tar.gz`, `..._cert-reports.tar.gz`, `..._cert-certs.tar.gz` — volume archives.
- Optional offsite: `BACKUP_REMOTE_HOST`/`BACKUP_REMOTE_PATH` (rsync) and `BACKUP_S3_BUCKET` (mc/aws).
- Retention: `RETENTION_DAYS` (default 7).

### Restore
Custom-format dump restore:
```
# DB (into the running postgres container)
docker exec -i importacao-postgres pg_restore -U importacao -d importacao --clean --if-exists \
  < ~/backups/importacao/importacao_<ts>.pgdump
```
`scripts/restore-test.sh` exercises a restore into a throwaway DB to validate a dump — use it to verify
backup integrity without touching production.
Volume restore: stop the consumer, extract the matching `*.tar.gz` into the volume mount, restart.

---

## 5. Rollback

### Automatic (during deploy)
If the post-deploy health check fails and a snapshot exists, `deploy.sh` restores the previous **code**
from `<DEPLOY_DIR>.rollback` (rsync, preserving `.env`), rebuilds, and re-checks health, reporting the
true result. **Migrations are forward-only and are NOT rolled back** — verify schema/data after.

### Manual code rollback
```
cd ~/importacao
# if a snapshot is still present:
rsync -a --delete --exclude '.env' ../importacao.rollback/ ./
docker compose -f docker-compose.prod.yml up -d --no-deps --build api web cert-api
curl -sf http://localhost:3050/health/ready
```
If no snapshot exists, redeploy a known-good SHA from a dev machine (`bash scripts/deploy.sh`) after
`git checkout <good-sha>` on a clean tree. If a migration is implicated, restore the pre-deploy
`*.pgdump` (§4) — the schema cannot be reverted by code rollback alone.

### Restart a single service
```
docker compose -f docker-compose.prod.yml restart api        # no rebuild
docker compose -f docker-compose.prod.yml up -d --no-deps --build cert-api   # rebuild one
```
</content>
