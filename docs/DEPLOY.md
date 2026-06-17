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
8. Preserva `.env` remoto.
9. Aplica migrations pendentes e aborta se falharem.
10. Rebuilda `api` e `web`.
11. Executa health check.
12. Grava `REVISION` com o SHA implantado.
13. Faz rollback de codigo se health falhar.

Evidencia:

- `scripts/deploy.sh`

## Backup E Restore

Backups sao gerados em:

- `/home/nicolas/backups/importacao/`

O backup e validado com `pg_restore --list`.

Pendencia:

- Documentar e testar restore completo em ambiente isolado.

## Rastreabilidade

O deploy grava o SHA completo implantado em:

- `/home/nicolas/importacao/REVISION`

Para conferir:

```bash
ssh nicolas@192.168.168.124 'cat /home/nicolas/importacao/REVISION'
```

O historico detalhado fica no `deploy.log` local e no output do deploy.

## Warnings Conhecidos

- `.env.sops.yaml` ausente no servidor; script usa `.env` existente.
- Build web emite warning CSS de `@import`.
- Backup pode avisar volumes nao encontrados.
