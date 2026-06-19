# Architecture

Ultima atualizacao: 2026-06-17

## Visao Geral

O projeto e um monorepo com tres servicos principais:

- Web React SPA em `apps/web`.
- API Node/Express em `apps/api`.
- Cert API Python/FastAPI em `apps/cert-api`.

Infra base:

- PostgreSQL 16.
- Redis.
- Docker Compose dev/prod.
- Deploy rsync para VPS/host `192.168.168.124`.

Evidencias:

- `README.md`
- `docker-compose.prod.yml`
- `apps/api/src/server.ts`
- `apps/web/src`
- `apps/cert-api`

## Fronteiras De Modulo

API Node:

- `auth`: autenticacao.
- `processes`: processos de importacao.
- `documents`: upload, processamento, extracao e comparativo.
- `validation`: checks, relatorio, historico e aceite manual.
- `ai`: providers, skills, harness, RAG e custos.
- `espelhos`: geracao e itens do espelho.
- `follow-up`: integracao e tracking.
- `email-ingestion`: IMAP/Gmail e classificacao.
- `communications`: drafts e envio de emails.
- `financial`: numerario e calculos.
- `sydle`: relatorio de compras/pagamentos internacionais, sync 15 min e
  conciliacao com processos.
- `alerts`, `audit`, `settings`, `health`, `admin`.

Web:

- Features por dominio em `apps/web/src/features`.
- Detalhe do processo centraliza abas em `ProcessDetailPage`.
- Comparativo usa `ValidationChecklist` e `DocumentComparison`.

Cert API:

- Serviço separado para certificacoes, relatorios, VTEX/ERP/WMS e cadastro de certificados.

## Fluxos Criticos

1. Upload/email -> `documents` -> extracao -> `documents.aiParsedData` e `importProcesses.aiExtractedData`.
2. Validacao -> `validation_results` -> historico -> aceite manual -> status/correction.
3. Espelho -> `process_items` -> templates por marca.
4. Email ingestion -> documentos/processos/comunicacoes.
5. Certificacao -> produtos/status/relatorios via cert-api.

## Decisoes Arquiteturais Registradas

ADRs canonicos estao em `docs/adr/`:

- `0001-monorepo-npm-workspaces.md`
- `0002-drizzle-orm.md`
- `0003-jwt-localstorage.md`
- `0004-cert-api-separate-service.md`
- `0005-design-system-v2.md`

## Riscos Arquiteturais

- Duas APIs (Node e cert-api) compartilham dominio visual, mas possuem stacks distintas.
- Fluxos de documento, IA, validacao e espelho tem regras cruzadas e exigem testes de regressao.
- Deploy por rsync exige master limpo e nao permite rollback por git no servidor.
