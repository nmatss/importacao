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

### AI extraction timeout

The AI extraction provider is selected via `AI_PROVIDER` in `.env`.
Production default is `AI_PROVIDER=ialocal` with `AI_ALLOW_EXTERNAL=false`.
External providers (`vertex`, `openrouter`) are opt-in only and require
`AI_ALLOW_EXTERNAL=true`.
If extraction times out or fails:

1. Check the `.env` for the active provider's credentials and egress policy:
   - `AI_PROVIDER=ialocal`: `IA_LOCAL_BASE_URL`, `IA_LOCAL_API_KEY`,
     `IA_LOCAL_MODEL`, `IA_LOCAL_ALLOWED_HOSTS`. Confirm the local gateway is
     reachable from the API container and that CPU/GPU load is not saturated.
   - `AI_PROVIDER=vertex`: `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`,
     `GOOGLE_VERTEX_CLIENT_EMAIL`, `GOOGLE_VERTEX_PRIVATE_KEY`,
     `AI_ALLOW_EXTERNAL=true`.
   - `AI_PROVIDER=openrouter`: `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`,
     `AI_ALLOW_EXTERNAL=true`.
2. Check the monthly spend cap `AI_MONTHLY_BUDGET_USD` — requests are blocked
   once the budget is exhausted for paid providers. `ialocal` does not consume
   this budget, but still uses request timeouts and local compute.
3. Check queue health before retrying:

```bash
ssh nicolas@192.168.168.124 "cd ~/importacao && docker compose -f docker-compose.prod.yml logs --tail=80 api | egrep -i 'ai-extraction|timeout|confidence|extraction'"
```

4. Try a smaller document or reprocess only the failed attachment. Very-low
   confidence (`<40%`) is stored as evidence but not projected into validation
   or espelho until the operator reprocesses/reuploads.
5. The feature degrades gracefully — manual data entry still works.

### OCR de PDF escaneado

O OCR local e opt-in: mantenha `DOCUMENT_OCR_ENABLED=0` ate instalar Poppler
(`pdftoppm`) e Tesseract no container da API, incluindo os idiomas `por` e
`eng`. Para ativar, configure `DOCUMENT_OCR_ENABLED=1`, revise os limites
`DOCUMENT_OCR_TIMEOUT_MS` e `DOCUMENT_OCR_MAX_PAGES`, e acompanhe no endpoint
`/metrics` as series `document_ocr_runs_total`, `document_ocr_pages_total` e
`document_ocr_duration_seconds`.

Uma falha de OCR nao bloqueia o documento: o fluxo continua pelo fallback
multimodal. Confirme a causa nos logs por `Local OCR unavailable` antes de
repetir o processamento. A evidencia da extracao mais recente fica em
`GET /api/documents/:id/extraction-evidence`, com pagina e trecho limitado.

### Lease de extração duplicada

Cada worker reivindica o `document_id` antes de iniciar OCR/IA. Uma mensagem
duplicada apenas registra `Skipping duplicate AI extraction` e não consome
modelo. Mantenha `DOCUMENT_EXTRACTION_LEASE_MS` acima do p99 de OCR+IA (o
default é 25 minutos; a API recusa valor menor que 2 minutos). Se houver queda
do worker, a lease expira e uma nova entrega retoma o documento; não apague ou
altere a lease diretamente no banco durante uma extração em curso.

### Auditoria e replay documental controlado

Antes de qualquer replay, preencha e aprove um plano em `docs/operations/`,
faça backup/restore test de banco e uploads e confirme fila/leases vazias. O
override `docker-compose.reprocess.yml` desativa Drive/Chat, espelho automático
e define `DOCUMENT_REPLAY_DEFER_DERIVED=1`, adiando validação/workflow até o
fechamento reconciliado de cada processo.

Operadores compilados disponíveis no container da API:

```bash
# Somente leitura: classifica sinais dos documentos other sem persistir texto.
node dist/operators/triage-other-documents.js --out=/tmp/other-triage.json

# Dry-run por padrão; --execute insere apenas runs históricos append-only.
node dist/operators/backfill-document-terminal-lineage.js --out=/tmp/lineage.json

# Somente leitura: Gmail permitido -> hash do anexo -> target no portal.
node dist/operators/audit-gmail-source-reconciliation.js \
  --after=2025/05/01 --out=/tmp/gmail-reconciliation.json
```

Os artefatos devem permanecer fora do repositório, com permissão `0600`. Para
validar todos os processos sem efeitos de negócio, use
`scripts/audit-process-completeness.mjs --execute`; o padrão ainda é dry-run e
o script exige `API_TOKEN` apenas pelo ambiente.

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

### API sem egress externo (login Google falhando, sync SYDLE falhando)

Sintoma que engana: a API responde, o health check fica **verde**, o container
alcanca banco, Redis, gateway do bridge e roteador da LAN em menos de 1 ms — e
mesmo assim nada sai para a internet. Na tela, o usuario le "Sua sessao
expirou" em loop. Ver `docs/INCIDENTE-2026-08-14-EGRESS-API.md`.

Suspeite disso quando: varias pessoas nao conseguem logar, o cron `sydle-sync`
falha em sequencia, ou os logs mostram `ETIMEDOUT` para
`https://oauth2.googleapis.com/token`.

Diagnostico em tres comandos — o terceiro e o que decide:

```bash
# 1. Por onde sai a rota default? Se for 192.168.208.1 (ia-local-net), e isso.
ssh nicolas@192.168.168.124 "docker exec importacao-api sh -c 'ip route | grep default'"

# 2. O container tem saida?
ssh nicolas@192.168.168.124 "docker exec importacao-api sh -c 'timeout 6 ping -c3 8.8.8.8'"

# 3. Um container NOVO no mesmo bridge tem saida?
ssh nicolas@192.168.168.124 "docker run --rm --network ia-local-net alpine:latest sh -c 'timeout 6 ping -c3 8.8.8.8'"
```

Container novo passando + API falhando = a rota default da API esta errada.

Quem falhou e por que (o controller nao loga o motivo do 401; o servico de
grupo loga):

```bash
ssh nicolas@192.168.168.124 "docker logs importacao-api --since 24h 2>&1 | grep 'Google Groups: error'"
```

Correcao ao vivo, sem downtime e sem perder a IA local:

```bash
ssh nicolas@192.168.168.124 "docker network disconnect ia-local-net importacao-api && \
  docker network connect --alias importacao-api --alias api --gw-priority -100 ia-local-net importacao-api"
```

A correcao duravel ja esta em `docker-compose.prod.yml` (`gw_priority`). Se a
rota voltar a sair por `ia-local-net` depois de um deploy, o compose foi
revertido — conferir antes de mexer na rede.

Confirme a recuperacao pelo banco, nao pelo health check:

```bash
ssh nicolas@192.168.168.124 "docker exec importacao-postgres psql -U importacao -d importacao -c \
  \"SELECT status, count(*) FROM sydle_sync_runs WHERE started_at > now() - interval '1 hour' GROUP BY 1;\""
```

---

## Rollback Manual

Production deploy is rsync-based. The server is not a git repository, so do
not use `git checkout` on the server. `scripts/deploy.sh` creates an
on-server code snapshot at `/home/nicolas/importacao.rollback` before syncing
and automatically restores it when post-deploy health checks fail.

Manual code rollback is only possible while that snapshot exists:

```bash
ssh nicolas@192.168.168.124 "test -d /home/nicolas/importacao.rollback"
ssh nicolas@192.168.168.124 "rsync -a --delete --exclude '.env' /home/nicolas/importacao.rollback/ /home/nicolas/importacao/"
ssh nicolas@192.168.168.124 "cd /home/nicolas/importacao && docker compose -f docker-compose.prod.yml build api web cert-api && docker compose -f docker-compose.prod.yml up -d"
```

Database rollback is not automatic. Use the pre-deploy PostgreSQL backup from
`scripts/backup-db.sh` only after explicit incident approval.

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

| Incident                  | Contact                                      |
| ------------------------- | -------------------------------------------- |
| Production server down    | Nicolas Matsuda (admin)                      |
| Database corruption       | Nicolas Matsuda                              |
| Oracle WMS unreachable    | TI Grupo Unico                               |
| Google API quota exceeded | Nicolas Matsuda (check Google Cloud Console) |
| Email delivery failure    | TI (check mta.imgnet.com.br relay)           |
