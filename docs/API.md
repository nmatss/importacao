# API

Ultima atualizacao: 2026-06-17

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

## Cert API

Servico Python separado para certificacoes:

- Saude: `/cert-api/api/health` via nginx/proxy.
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
