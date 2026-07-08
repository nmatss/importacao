# API

Ultima atualizacao: 2026-06-19

## API Node

Base em desenvolvimento: `apps/api`.

Principais grupos:

- `/api/auth`
- `/api/processes`
- `/api/documents`
- `/api/validation`
- `/api/espelhos`
- `/api/follow-up`
- `/api/email-ingestion`
- `/api/communications`
- `/api/financial`
- `/api/alerts`
- `/api/settings`
- `/api/ai`
- `/api/assistant`
- `/api/sydle`
- `/health`
- `/metrics`

Evidencias:

- `apps/api/src/modules/*/routes.ts`
- `apps/api/src/server.ts`
- `README.md`

## Endpoints Criticos De Validacao

- `GET /api/validation/:processId`
- `POST /api/validation/:processId/run`
- `GET /api/validation/:processId/report`
- `PATCH /api/validation/results/:id/resolve`
- `POST /api/validation/:processId/anomalies`
- `POST /api/validation/:processId/correction-draft`

Evidencias:

- `apps/api/src/modules/validation/routes.ts`
- `apps/web/src/features/validation/ValidationChecklist.tsx`

## Endpoints Criticos De Documentos

- `GET /api/documents/process/:processId`
- `GET /api/documents/process/:processId/extraction-history`
- `GET /api/documents/:id/extraction-history`
- `POST /api/documents/:id/reprocess` admin-only
- `DELETE /api/documents/:id` admin-only

O historico por processo inclui snapshots arquivados antes de delete, quando
`document_id` pode ficar `null`.

Evidencias:

- `apps/api/src/modules/documents/routes.ts`
- `apps/api/src/modules/documents/service.ts`

## Assistente Operacional RAG

- `POST /api/assistant/query`

Request:

```json
{
  "question": "Quais atendimentos pendentes precisam de acao?",
  "processId": 123,
  "limit": 10
}
```

Campos:

- `question`: obrigatorio, 3 a 1000 caracteres.
- `processId`: opcional; restringe a busca ao processo.
- `limit`: opcional, 3 a 20 fontes retornadas.

Response:

- `answer`: resposta em PT-BR.
- `sources`: fontes internas recuperadas com tipo, titulo, trecho, score e URL interna quando aplicavel.
- `confidence`: confianca operacional calculada a partir do ranking de fontes.
- `mode`: `ai` quando a IA respondeu com RAG; `deterministic` quando houve fallback por evidencias.

Fontes consultadas:

- Processos, alertas, atendimentos/e-mails enviados, e-mails recebidos, validacoes, documentos, follow-up, eventos de processo, auditoria para admin e base de conhecimento RAG.

Evidencias:

- `apps/api/src/modules/assistant/routes.ts`
- `apps/api/src/modules/assistant/service.ts`
- `apps/api/src/modules/ai/rag/retriever.ts`
- `apps/web/src/features/assistant/AssistantPage.tsx`

## SYDLE - Compras E Pagamentos

Relatorio operacional de compras e pagamentos internacionais sincronizado da
SYDLE a cada 10 minutos. Rotas de leitura/exportacao exigem usuario autenticado
com acesso ao modulo de importacao; sincronizacao manual, configuracao e
historico de sync exigem administrador. A sincronizacao real depende das
variaveis `SYDLE_*`; sem configuracao, o job registra `skipped`.

O modo real validado para Sydle One usa `SYDLE_SOURCE_TYPE=sydle_one_class`,
login `sys/auth/signIn` e `POST _classId/{SYDLE_CLASS_ID}/_search`. A classe de
pagamento internacional validada e `68bf1179b042c72f03993928`.

Endpoints:

- `GET /api/sydle/payments-report` autenticado
- `GET /api/sydle/payments-report/summary` autenticado
- `GET /api/sydle/payments-report/export.csv` autenticado
- `GET /api/sydle/payments-report/export.xlsx` autenticado
- `GET /api/sydle/payments-report/export.pdf` autenticado
- `GET /api/sydle/payments-report/:id` autenticado; `rawPayload` apenas para admin
- `GET /api/sydle/sync-runs` admin-only
- `POST /api/sydle/sync-now` admin-only

As respostas de listagem/detalhe e as exportações preservam as colunas do
relatório SYDLE Analytics/CSV quando disponíveis: protocolo, número da invoice,
beneficiário, marca, tipo, vencimento, moeda, valor a pagar, emissão Invoice/PI,
criação da tarefa, exceção, motivo da exceção, código do processo, embarque,
prazo pós-embarque e última alteração.
Valores de câmbio/BRL, banco, contrato e remessa só são exibidos quando vêm da
SYDLE; o relatório não preenche esses campos com estimativas do portal.

Filtros principais:

- `search`
- `processCode`
- `supplier`
- `brand`
- `currency`
- `logisticStatus`
- `paymentStatus`
- `paymentType`
- `matchStatus`
- `dueFrom`
- `dueTo`
- `updatedFrom`
- `updatedTo`
- `page`
- `limit`

`paymentType` aceita os valores legados `deposit`/`balance` e os valores
granulares da SYDLE `deposit_in_advance`, `balance_before_shipment` e
`balance_after_shipment`, exibidos/exportados como no Excel da SYDLE.

Sincronizacao:

- `POST /api/sydle/sync-now`: sincronizacao manual incremental, mesmo cursor do
  cron.
- `POST /api/sydle/sync-now?full=1`: full resync administrativo para reprocessar
  registros antigos quando o mapeamento SYDLE/API muda. Usa a API real da SYDLE,
  nao estimativas do portal.

Evidencias:

- `apps/api/src/modules/sydle/routes.ts`
- `apps/api/src/modules/sydle/service.ts`
- `apps/web/src/features/sydle-payments/SydlePaymentsPage.tsx`
- `docs/SYDLE-INTEGRATION.md`

## Cert API

Servico Python separado para certificacoes:

- Saude: `/cert-api/api/health` via nginx/proxy.
- Readiness: `/cert-api/api/ready` via nginx/proxy.
- Rotas protegidas exigem `X-API-Key`; em producao o header e injetado pelo nginx do `web` a partir de `CERT_API_KEY`.
- Relatorios, validacao e produtos ficam sob `apps/cert-api`.

Evidencias:

- `docs/cert-api-openapi.json`
- `README.md`
- `apps/cert-api`

## Documentacao Interativa

README registra Swagger/OpenAPI em:

- `/api/docs`
- `/api/docs/openapi.json`

## Pendencias

- Gerar snapshot OpenAPI atualizado da API Node no repo.
- Documentar contratos de request/response dos endpoints criticos.
- Padronizar query keys frontend com `apps/web/src/shared/api/query-keys.ts`.
