# Deploy

Ultima atualizacao: 2026-06-19

## Producao

Servidor conhecido: `192.168.168.124`.

Diretorio remoto padrao:

- `/home/nicolas/importacao`

Compose:

- `docker-compose.prod.yml`

## Caminho Recomendado

```bash
bash scripts/deploy.sh 192.168.168.124
```

O workflow manual `.github/workflows/deploy.yml` tambem usa este mesmo caminho:
ele roda `scripts/deploy.sh` no runner e o script sincroniza o codigo por rsync.
Nao ha `git pull` no servidor de producao.

O script:

1. Exige branch `master`.
2. Exige working tree limpa.
3. Confere `origin/master`.
4. Solicita confirmacao.
5. Executa backup PostgreSQL obrigatorio.
6. Cria snapshot de rollback do codigo remoto.
7. Sincroniza codigo por rsync, preservando `.env`, `.env.sops.yaml`, uploads
   e logs remotos.
8. Gera `.env` remoto via SOPS + age a partir de `.env.sops.yaml`; se falhar,
   o deploy aborta para evitar subir com segredo remoto obsoleto.
9. Bloqueia deploy se o `.env` remoto estiver com `SYDLE_SYNC_ENABLED=true`,
   salvo rollout financeiro aprovado com `ALLOW_SYDLE_SYNC_DEPLOY=1`.
10. Renderiza `infra/alertmanager/alertmanager.yml` a partir de
    `infra/alertmanager/alertmanager.webhook.yml.template` quando
    `ALERTMANAGER_WEBHOOK_URL` esta configurado; se estiver vazio, mantem o
    receiver `noop`.
11. Valida `docker compose -f docker-compose.prod.yml config --quiet` no
    servidor e confirma a existencia da rede externa `ia-local-net` antes de
    migrations/restart.
12. Aplica migrations pendentes e aborta se falharem.
13. Executa `cert-volumes-init` explicitamente para corrigir ownership dos
    volumes `cert-reports` e `cert-certs` para o usuario 1001 da cert-api,
    mesmo com o restart principal usando `--no-deps`.
14. Rebuilda `api`, `web` e `cert-api`.
15. Executa health check da API, readiness do `cert-api` e health do `web`.
16. Atualiza Prometheus/Alertmanager/Grafana para carregar configuracoes novas.
17. Grava `REVISION` com o SHA implantado.
18. Faz rollback de codigo se health falhar.

Evidencia:

- `scripts/deploy.sh`

Requisito de segredo:

- `CERT_API_KEY` deve existir no `.env` remoto. O compose de producao falha se
  a variavel estiver ausente, e o nginx do `web` usa esse valor para injetar
  `X-API-Key` no proxy interno `/cert-api/` somente apos validar o JWT do
  usuario em `/api/auth/me`.
- `GRAFANA_ADMIN_PASSWORD` deve existir no `.env` remoto. Nao ha fallback
  `changeme` em producao.
- `GOOGLE_CLIENT_ID` e `VITE_GOOGLE_CLIENT_ID` devem existir e apontar para o
  mesmo OAuth Client ID autorizado para a origem publica do frontend.
- Destinatarios KIOM, Fenicia e ISA devem ser configurados no sistema em
  `Configuracoes > Destinatarios operacionais`. `KIOM_EMAIL`, `FENICIA_EMAIL` e
  `ISA_EMAIL` continuam aceitos no `.env` remoto apenas como fallback opcional.
- `COMMUNICATION_ALLOWED_RECIPIENTS` e fallback opcional para e-mails/dominios
  adicionais. O container `api` recebe esta variavel; sem cadastro operacional ou
  allowlist, o envio e bloqueado com 403.
- `CORS_ORIGIN` e `GOOGLE_GROUP_ALLOWED` sao obrigatorios em producao. O compose
  falha antes do build se qualquer um estiver ausente, evitando boot sem login
  Google ou com CORS inseguro.
- `TRUST_PROXY` padrao `1` em producao para rate limit/autenticacao enxergarem
  o IP real encaminhado pelo Nginx/reverse proxy.
- Variaveis WMS/ERP/Sheets da `cert-api` (`GOOGLE_SHEETS_SPREADSHEET_ID`,
  `WMS_ORACLE_*`, `ERP_*`, `ERP_MSSQL_*`) devem existir no `.env` remoto.
  O compose falha cedo se alguma estiver ausente.
- Variaveis `LINX_*` sao repassadas ao `cert-api`. Mantenha
  `LINX_WRITE_ENABLED=false` ate a descoberta/validacao final de
  `PROP_PRODUTOS`.
- `ALERTMANAGER_WEBHOOK_URL` e opcional, mas se existir deve apontar para um
  bridge compatível com payload nativo do Alertmanager, nao diretamente para
  Google Chat.
- `SYDLE_SYNC_ENABLED` deve permanecer `false` para go-live sem contrato/API
  real da SYDLE. O deploy aborta se encontrar `true`, a menos que
  `ALLOW_SYDLE_SYNC_DEPLOY=1` seja usado em um rollout aprovado apos UAT
  financeiro com identificador estavel de pagamento e payload mapeado.

## Exposicao HTTP/TLS

- O container `web` publica `127.0.0.1:8085:80` no compose de producao. Nao
  exponha esta porta diretamente para a rede.
- TLS publico deve terminar no Nginx externo descrito em `infra/nginx/prod.conf`
  e `docs/TLS.md`.
- Com JWT no browser, HTTP publico e bloqueador de go-live.

## Backup E Restore

Backups sao gerados em:

- `/home/nicolas/backups/importacao/`

O backup e validado com `pg_restore --list`.

Volumes persistentes sao arquivados via Docker volume mount:

- `importacao_uploads`
- `importacao_cert-reports`
- `importacao_cert-certs`

Restore testado:

- Em 2026-06-17, `scripts/restore-test.sh` foi executado no servidor usando o
  backup `/home/nicolas/backups/importacao/importacao_2026-06-17_203311.pgdump`.
- Resultado: restore em banco temporario `importacao_restore_test`, 30 tabelas,
  273 processos, cleanup concluido.
- Execucao recorrente agendada no crontab do servidor: domingos as 03:20, log em
  `/home/nicolas/importacao/logs/restore-test.log`.
- Pendencia restante: alerta externo em caso de falha e medicao formal de RTO.

## Rastreabilidade

O deploy grava o SHA completo implantado em:

- `/home/nicolas/importacao/REVISION`

Para conferir:

```bash
ssh nicolas@192.168.168.124 'cat /home/nicolas/importacao/REVISION'
```

O historico detalhado fica no `deploy.log` local e no output do deploy.

## Warnings Conhecidos

- Backup pode avisar volumes nao encontrados.
- Se `/api/ready` da cert-api retornar `REPORTS_DIR not writable`, corrija o
  volume manualmente com:

```bash
docker run --rm -v importacao_cert-reports:/data alpine chown -R 1001:1001 /data
```
