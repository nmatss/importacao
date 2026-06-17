# Deploy

Ultima atualizacao: 2026-06-17

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

O script:

1. Exige branch `master`.
2. Exige working tree limpa.
3. Confere `origin/master`.
4. Solicita confirmacao.
5. Executa backup PostgreSQL obrigatorio.
6. Cria snapshot de rollback do codigo remoto.
7. Sincroniza codigo por rsync.
8. Gera `.env` remoto via SOPS + age a partir de `.env.sops.yaml`; se falhar,
   preserva o `.env` existente como fallback operacional.
9. Aplica migrations pendentes e aborta se falharem.
10. Rebuilda `api`, `web` e `cert-api`.
11. Executa health check da API e readiness do `cert-api`.
12. Grava `REVISION` com o SHA implantado.
13. Faz rollback de codigo se health falhar.

Evidencia:

- `scripts/deploy.sh`

Requisito de segredo:

- `CERT_API_KEY` deve existir no `.env` remoto. O compose de producao falha se a variavel estiver ausente, e o nginx do `web` usa esse valor para injetar `X-API-Key` no proxy `/cert-api/`.

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
