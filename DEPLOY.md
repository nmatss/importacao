# DEPLOY.md — Production Deployment Guide

> Grounded in: `scripts/deploy.sh`, `scripts/backup-db.sh`, `scripts/apply-pending-migrations.sh`,
> `docker-compose.prod.yml`, `apps/api/Dockerfile`, `apps/api/entrypoint.sh`,
> `apps/web/Dockerfile`, `apps/cert-api/Dockerfile`, `apps/cert-api/entrypoint.sh`,
> `apps/api/package.json`, `.env.example`, `.sops.yaml`, `scripts/generate-env-from-vault.sh`.
> Issue references (`#60`, `#78`, `#85`) come from the repo's known-issues tracking.

---

## 1. Deployment architecture

The production stack runs as a single Docker Compose project (`docker-compose.prod.yml`)
on one host. Services:

| Service | Container | Image / build | Host exposure | Purpose |
|---|---|---|---|---|
| `api` | `importacao-api` | build `apps/api` (node:22-alpine) | `127.0.0.1:3050 -> 3001` | Main backend (Express). Internal port 3001. |
| `web` | `importacao-web` | build `apps/web` (nginx:alpine) | `8085 -> 80` | SPA (Vite build) + nginx reverse proxy to api/cert-api. |
| `cert-api` | `importacao-cert-api` | build `apps/cert-api` (python:3.12-slim) | internal only (`8000`) | Certification service (Sheets + Oracle WMS + MSSQL ERP). |
| `postgres` | `importacao-postgres` | postgres:16-alpine | `127.0.0.1:5450 -> 5432` | Primary database. |
| `redis` | `importacao-redis` | redis:7-alpine | `expose 6379` (no host port) | Cache / rate-limit store. |
| `prometheus` | `importacao-prometheus` | prom/prometheus:v2.54.1 | `expose 9090` | Metrics scrape, 30d retention. |
| `alertmanager` | `importacao-alertmanager` | prom/alertmanager:v0.27.0 | `expose 9093` (internal) | Routes Prometheus alerts to a webhook bridge. |
| `grafana` | `importacao-grafana` | grafana/grafana:11.2.2 | `127.0.0.1:3030 -> 3000` | Dashboards. |
| `certbot` | `importacao-certbot` | certbot/certbot | profile `tls` (opt-in) | Let's Encrypt renewal; only with `--profile tls`. |

Notes grounded in compose:
- `api`, `cert-api`, `web` all run with `security_opt: no-new-privileges:true`.
- `api` joins an **external** docker network `ia-local-net` (must pre-exist: `docker network create ia-local-net`) so it can reach the on-prem IA_LOCAL gateway.
- Persistent named volumes: `pgdata`, `redisdata`, `uploads`, `cert-reports`, `cert-certs`, `prometheusdata`, `grafanadata`, `alertmanagerdata`, `letsencrypt`, `certbot-webroot`.
- Service start ordering uses healthchecks: `web` waits for `api` + `cert-api` healthy; `api` waits for `postgres` + `redis` healthy; `cert-api` waits for `postgres` healthy.

### Prod host model (rsync, NOT a git repo)

The production server is **not** a git checkout. `scripts/deploy.sh` runs from a developer's
machine and pushes code via `rsync -avz --delete` over SSH (default
`nicolas@192.168.168.124:/home/nicolas/importacao`). Consequences:
- There is no `git pull` on the server; the developer's clean `master` working tree IS the release.
- Rollback restores **code only**, from an on-server snapshot (`<DEPLOY_DIR>.rollback`), not from a git SHA.
- The deployed SHA is recorded in `<DEPLOY_DIR>/REVISION` after a successful deploy.

---

## 2. deploy.sh flow

`bash scripts/deploy.sh [server-ip]` — overridable via `DEPLOY_USER`, `DEPLOY_DIR`,
`COMPOSE_FILE`, `HEALTH_ENDPOINT`, `HEALTH_RETRIES`, `HEALTH_INTERVAL`, `SKIP_BACKUP`.

Pre-flight (aborts on any failure):
1. Must be on `master`.
2. Working tree must be clean.
3. Local `master` must equal `origin/master` (`git fetch` + SHA compare).
4. Interactive confirmation prompt.

Deploy steps:
1. **[1/8] Mandatory Postgres backup** — runs `backup-db.sh --remote <server> --user <user>`.
   A backup failure **aborts the deploy** (unless `SKIP_BACKUP=1`, not recommended).
2. **Snapshot for rollback** — `cp -al <DEPLOY_DIR> <DEPLOY_DIR>.rollback` (hardlink copy, falls back to `cp -a`).
   If the snapshot fails, automatic rollback becomes unavailable (warns, continues).
3. **[2/8] rsync code** — `--delete` with excludes for `.env`, `.env.sops.yaml`, `node_modules`,
   `dist`, `uploads`, `logs`, `.git`, `__pycache__`, `.venv`, `*.db`, `reports/`, cert-api
   `__pycache__`/`certifications.db`/`reports`, and `deploy.log`. Then `mkdir -p logs`.
4. **[3/8] Generate `.env`** — runs `scripts/generate-env-from-vault.sh` on the server (SOPS/Vault).
   Non-blocking: on failure it keeps the existing server `.env`.
5. **[4/8] Render Alertmanager config** — inline Python reads `ALERTMANAGER_WEBHOOK_URL` from `.env`
   and renders `infra/alertmanager/alertmanager.webhook.yml.template` -> `infra/alertmanager/alertmanager.yml`.
   Empty URL keeps the checked-in noop config. Errors if the URL points directly at `chat.googleapis.com`
   (it must point to a webhook **bridge**, not Google Chat directly).
6. **[5/8] Validate compose** — `docker compose -f <file> config --quiet`; aborts before migrations if invalid.
7. **[6/8] Forward-only migrations** — `scripts/apply-pending-migrations.sh` (idempotent). Failure aborts
   **before** starting new containers.
8. **[7/8] Build + start** — `docker compose -f <file> up -d --no-deps --build api web cert-api`.
   (Postgres/Redis/monitoring are not rebuilt here.)
9. **[8/8] Health check** — polls `HEALTH_ENDPOINT` (default `http://localhost:3050/health/ready`)
   up to `HEALTH_RETRIES` (30) every `HEALTH_INTERVAL` (2s) on the server.
   - **On failure:** if a rollback snapshot exists, restore code (`rsync -a --delete --exclude '.env'`
     from `.rollback`), rebuild, re-check health, and report the TRUE post-rollback state. If no snapshot,
     leave the failed release in place. **Database migrations are forward-only and are NOT rolled back.**
   - **On success:** also runs a cert-api readiness check (`/api/ready` inside `importacao-cert-api`),
     writes `REVISION`, removes the rollback snapshot, prints `docker ps`, and notifies success.

Deploy notifications go to `GOOGLE_CHAT_WEBHOOK_URL` if set (best-effort).

> Not zero-downtime: `api`/`web`/`cert-api` are rebuilt in place.

---

## 3. Migrations: the real apply path (known debt)

The Drizzle journal is **frozen at 0010**. The container entrypoint
(`apps/api/entrypoint.sh`) runs `node dist/shared/database/migrate.js`, which applies the
journaled migrations up to 0010 on every api start.

Migrations **0011–0018** are NOT in the Drizzle journal. They are applied **idempotently** by
`scripts/apply-pending-migrations.sh` (invoked by deploy step [6/8]), each guarded with
`IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS` so re-running is safe:

```
0011_proforma_invoice.sql           # ALTER TYPE (cannot run in a transaction)
0012_process_rename_and_lock.sql    # ADD COLUMN, process lock + rename
0013_ai_usage_log.sql               # AI usage log (monthly budget cap)
0014_validation_resolution_note.sql # validation_results.resolution_note
0015_validation_history.sql         # validation/extraction historization (audit)
0016_pre_cons_tables.sql
0017_sydle_purchase_payments.sql
0018_validation_run_links.sql
```

Manual fallback (from `deploy.sh` footer) if step [6/8] failed — `docker cp` the file into
`importacao-postgres` then `psql -f`, or just re-run `scripts/apply-pending-migrations.sh`.

> **Debt:** these 8 migrations should eventually be folded back into the Drizzle journal so that
> the automatic `migrate.js` path is the single source of truth.

---

## 4. Build notes

- **api** (`apps/api/Dockerfile`): multi-stage node:22-alpine. `npm run build` =
  `tsc && mkdir -p dist/modules/ai/knowledge && cp src/modules/ai/knowledge/*.json dist/modules/ai/knowledge/`.
  The knowledge JSON files (`carriers.json`, `ean.json`, `ncms.json`, `parties.json`, `ports.json`,
  `premissas.json`) are **NOT** emitted by `tsc`; the build step copies them into `dist`. Runtime image
  runs as `USER node`, ships `dist` + `drizzle`, and `su-exec` is installed.
- **web** (`apps/web/Dockerfile`): builds with `VITE_API_URL` / `VITE_GOOGLE_CLIENT_ID` build args
  (baked at build time), serves via nginx:alpine using `nginx.conf` as a template.
- **cert-api** (`apps/cert-api/Dockerfile`): three stages — Oracle Instant Client, Python deps,
  runtime. Installs `gosu` for the entrypoint privilege-drop (see §6). Image intentionally starts as root.

---

## 5. Secrets management (SOPS / age)

Secrets live encrypted in `.env.sops.yaml`, decrypted by `scripts/generate-env-from-vault.sh`
during deploy step [3/8] to produce the server `.env` (the encrypted file is rsync-excluded;
`.env` is never rsynced). `.sops.yaml` defines the age recipients / encryption rules.
`.env.sops.yaml.example` documents the structure; `.env.example` is the full plaintext reference.

> Never commit a plaintext `.env`. The host `.env` is generated, not synced.

---

## 6. cert-api volume ownership (#85) — now durable

A fresh docker **named volume** is created `root:root`, which broke writes for the cert-api app
process (uid 1001) — manifesting as `PermissionError` on `/app/reports` (HTTP 500 on report export).
Previously patched with a one-time manual `chown`, but a recreated volume re-broke it.

This is now durable via `apps/cert-api/entrypoint.sh` + `apps/cert-api/Dockerfile`:
- The container **starts as root** (intentional).
- The entrypoint runs `chown -R 1001:1001 /app/reports /app/certs` (best-effort, never fatal) on **every start**.
- It then drops privileges with `gosu appuser` before `exec`'ing uvicorn — the **app never runs as root**.
- `no-new-privileges:true` in compose is gosu-compatible (gosu drops, never escalates).

Volumes affected: `cert-reports -> /app/reports`, `cert-certs -> /app/certs` (cert PDFs / INMETRO/ANVISA
evidence). **No manual chown is needed anymore.**

---

## 7. ENV var reference

Source of truth: `.env.example` + the `environment:` blocks in `docker-compose.prod.yml`.
The compose file uses `${VAR:?...}` for hard-required vars (deploy fails fast if unset).

**Legend — "Required before user validation":** ✅ must be set for the product to function in the
demo/UAT; ⚠️ required only when the related feature is enabled; ◻️ optional / has a safe default.

### Core / Postgres
| Var | Req | Notes |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | ✅ | `${VAR:?}` hard-required by compose. |
| `DATABASE_URL` | ✅ | Built from the three above for api & cert-api. |
| `JWT_SECRET` | ✅ | **Secret.** Random, strong. |
| `JWT_EXPIRES_IN` | ◻️ | Default `24h`. |
| `NODE_ENV` / `API_PORT` | ◻️ | Set by compose (`production` / `3001`). |
| `REDIS_URL` | ◻️ | Fixed `redis://redis:6379` in compose. |
| `LOG_LEVEL` | ◻️ | Default `info`. |

### Auth / CORS / proxy
| Var | Req | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` | ✅ | `${VAR:?}` required (api env + web build arg). |
| `ALLOWED_DOMAIN` | ⚠️ | Restrict Google login to a domain. |
| `GOOGLE_ADMIN_EMAIL` / `GOOGLE_GROUP_ALLOWED` | ⚠️ | Group-based access; **fail-closed** — empty group = nobody logs in unless `GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET=true`. |
| `CORS_ORIGIN` | ✅ | CSV of allowed origins (e.g. the web host). Empty = blocked cross-origin. |
| `TRUST_PROXY` | ✅ (set deliberately) | **New.** Default `loopback` (secure). Set to a hop count (e.g. `1`) or CIDR when the reverse proxy is NOT on loopback, else per-IP rate limiting / `/metrics` allow-list see the proxy IP. **Never `true` in prod** (lets clients forge `req.ip`). |
| `VITE_API_URL` | ⚠️ | Web build arg; set to `/api` for the Docker prod build. |

### AI / extraction
| Var | Req | Notes |
|---|---|---|
| `AI_PROVIDER` | ✅ | Default `ialocal`. Enum `ialocal` \| `vertex` \| `openrouter` (`shared/config/env.ts`). |
| `AI_ALLOW_EXTERNAL` | ✅ | Default `false`. Must be `true` to use `vertex`/`openrouter` (env validation rejects otherwise). |
| `AI_MONTHLY_BUDGET_USD` | ◻️ | Default `200` in compose / `26` in `.env.example`. Local model is free (doesn't consume budget). |
| `IA_LOCAL_BASE_URL` | ⚠️(ialocal) | Default `http://ia-local-gateway:8443/v1`. Required when `AI_PROVIDER=ialocal`. |
| `IA_LOCAL_API_KEY` | ⚠️(ialocal) | **Secret** — gateway bearer (COPILOTO_GATEWAY_TOKEN). Required for ialocal. |
| `IA_LOCAL_MODEL` / `IA_LOCAL_EMBED_MODEL` / `IA_LOCAL_ALLOWED_HOSTS` | ◻️ | Default `unico-docintel` / `bge-m3` / `ia-local-gateway`. |
| `AI_USE_SPECIALIST` | ◻️ | Default `1` (specialist pipeline). |
| `AI_LOCAL_CHAT_TIMEOUT_MS` / `AI_CHAT_TIMEOUT_MS` / `DOCUMENT_AI_EXTRACTION_TIMEOUT_MS` | ◻️ | Timeouts; local CPU gets a larger ceiling. |
| `DOCUMENT_PROCESSING_STALE_MINUTES` | ◻️ | Default `30`; stalls become explicit errors to stop infinite polling. |
| `GOOGLE_VERTEX_PROJECT` / `GOOGLE_VERTEX_LOCATION` / `GOOGLE_VERTEX_CLIENT_EMAIL` / `GOOGLE_VERTEX_PRIVATE_KEY` | ⚠️(vertex) | **Secrets.** Required when `AI_PROVIDER=vertex`. **Blocked by IAM 403 — issue #60** (needs `roles/aiplatform.user` + `aiplatform.googleapis.com` enabled). Until resolved, Vertex cannot be used. |
| `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL` | ⚠️(openrouter) | External — do not use with sensitive docs without formal opt-in. |

### Operational emails (#78)
| Var | Req | Notes |
|---|---|---|
| `KIOM_EMAIL` | ✅ (or set in UI) | Operational recipient. **Fallback only** — preferred path is *Configurações > Destinatários operacionais* (DB). **If neither DB nor env is set, sending is blocked ("Destinatário não autorizado") — #78.** |
| `FENICIA_EMAIL` | ✅ (or set in UI) | Same as above (CSV supported). |
| `ISA_EMAIL` | ✅ (or set in UI) | Same as above. Empty in `.env.example`. |
| `COMMUNICATION_ALLOWED_RECIPIENTS` | ⚠️ | Extra allowlist (exact emails or domains). KIOM/FENICIA/ISA are auto-allowed. |

### SMTP / email ingestion
| Var | Req | Notes |
|---|---|---|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | ⚠️ | **Secret** (`SMTP_PASS`). Required for outbound email. |
| `SMTP_SECURE` / `SMTP_TLS_REJECT_UNAUTHORIZED` | ◻️ | Defaults `false` / `true`. Only set reject=false for internal self-signed relays. |
| `GMAIL_SHARED_MAILBOX` | ⚠️ | Gmail API via service account (domain-wide delegation, `gmail.modify`). |
| `EMAIL_INGESTION_ENABLED` / `EMAIL_ALLOWED_SENDERS` / `IMAP_*` | ⚠️ | IMAP fallback for inbound ingestion. Default ingestion `false`. |

### Integrations: Drive / Odoo / Sydle / Chat
| Var | Req | Notes |
|---|---|---|
| `GOOGLE_DRIVE_CLIENT_EMAIL` / `GOOGLE_DRIVE_PRIVATE_KEY` / `GOOGLE_DRIVE_ROOT_FOLDER_ID` | ⚠️ | **Secret** (private key). Drive integration. |
| `GOOGLE_DRIVE_PRE_CONS_FOLDER_ID` | ⚠️ | Pre-Cons sync (every 6h). Folder must be shared (Viewer) with the SA or sync is silently skipped. |
| `GOOGLE_CHAT_WEBHOOK_URL` | ◻️ | Deploy + app notifications. |
| `ALERTMANAGER_WEBHOOK_URL` | ◻️ | Must point at a webhook **bridge**, never Google Chat directly. Empty = noop receiver. |
| `ODOO_URL` / `ODOO_DB` / `ODOO_USER` / `ODOO_PASSWORD` | ⚠️ | **Secret** (password). Odoo integration. |
| `SYDLE_SYNC_ENABLED` | ⚠️ | Default `false`. When `true`, scheduler syncs every 15 min. |
| `SYDLE_BASE_URL` / `SYDLE_API_TOKEN` | ⚠️ | **Secret** (token). Required when Sydle sync enabled. Plus `SYDLE_*` tuning vars (path/auth/paging/timeout) with defaults. |

### Observability / Grafana
| Var | Req | Notes |
|---|---|---|
| `SENTRY_DSN` | ◻️ | Empty = Sentry disabled (no-op init). |
| `APP_VERSION` | ◻️ | Release tag for Sentry; default `dev`. Use deploy SHA. |
| `METRICS_ALLOW_PRIVATE_NETWORKS` | ◻️ | Default `true`. |
| `GRAFANA_ADMIN_PASSWORD` | ✅ | `${VAR:?}` required. **Secret.** |
| `GRAFANA_ROOT_URL` | ◻️ | Default `http://localhost:3030`. |

### cert-api (Sheets + ERP)
| Var | Req | Notes |
|---|---|---|
| `CERT_API_KEY` | ✅ | `${VAR:?}` required in **both** cert-api and web (nginx injects it on the `/cert-api` proxy). **Secret.** |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ✅ | `${VAR:?}` required. (Sheets creds reuse `GOOGLE_DRIVE_CLIENT_EMAIL`/`PRIVATE_KEY`.) |
| `WMS_ORACLE_HOST/PORT/SID/USER/PASS` | ✅ | `${VAR:?}` required. **Secret** (pass). Oracle WMS. |
| `ERP_PUKET_HOST/DB`, `ERP_IMG_HOST/DB`, `ERP_MSSQL_USER/PASS` | ✅ | `${VAR:?}` required. **Secret** (pass). MSSQL ERPs. |
| `LINX_WRITE_ENABLED` + `LINX_*` | ◻️ | Default `false` — certificates saved in portal but NOT written to Linx until schema confirmed. |

---

## 8. Pre-deploy checklist (before user validation)

- [ ] `master` clean and == `origin/master`.
- [ ] External docker network exists: `docker network create ia-local-net` (idempotent).
- [ ] All ✅ vars present in `.env.sops.yaml` (decrypts cleanly).
- [ ] Operational recipients set (env **or** UI) — else email send is blocked (#78).
- [ ] `AI_PROVIDER=ialocal` reachable, OR Vertex IAM (#60) resolved before flipping to `vertex`.
- [ ] `cert-certs` / `cert-reports` volumes present (entrypoint handles ownership — #85).
- [ ] Run `bash scripts/deploy.sh` (mandatory backup runs first).
</content>
</invoke>
