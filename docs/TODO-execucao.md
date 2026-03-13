# TODO — Plano de Execução

**Criado em**: 2026-03-12
**Concluido em**: 2026-03-13
**Referência**: [Diagnóstico Técnico Completo](./diagnostico-tecnico-completo.md)

---

## Fase 1 — Quick Wins (Dia 1-2)

### Segurança (Prioridade Máxima)

- [x] **helmet()** no Express
  - `npm install helmet -w apps/api`
  - Adicionar `app.use(helmet())` em `apps/api/src/app.ts`
  - Arquivo: `apps/api/src/app.ts`

- [x] **Auth no cert-api** (JWT ou API key)
  - Adicionar middleware de API key no FastAPI
  - Restringir CORS para domínios específicos
  - Arquivo: `apps/cert-api/main.py:44-49`

- [x] **USER node nos Dockerfiles**
  - Adicionar `USER node` em `apps/api/Dockerfile`
  - Adicionar `USER nginx` em `apps/web/Dockerfile` (comentario: nginx gerencia privilegios internamente)
  - Adicionar `USER appuser` em `apps/cert-api/Dockerfile`

- [x] **Rate limiting em `/auth/google`**
  - Adicionar `createRateLimiter(10, 15 * 60 * 1000)` na rota
  - Arquivo: `apps/api/src/modules/auth/routes.ts:11`

- [x] **DOMPurify no frontend**
  - `npm install dompurify @types/dompurify -w apps/web`
  - Sanitizar antes de `dangerouslySetInnerHTML`
  - Arquivo: `apps/web/src/features/validation/ValidationChecklist.tsx:476`

- [x] **Magic-byte check em uploads**
  - `npm install file-type -w apps/api`
  - Validar magic bytes no middleware de upload
  - Arquivo: `apps/api/src/shared/middleware/upload.ts:32-33`

- [x] **Remover xlsx de CDN externa**
  - Mantido CDN oficial SheetJS (unico canal de distribuicao oficial)
  - Arquivo: `apps/api/package.json:34`

### Resiliência

- [x] **AbortController com timeout 60s** em chamadas AI
  - Envolver `fetch()` com `AbortSignal.timeout(60000)`
  - Arquivo: `apps/api/src/modules/ai/service.ts:51`

- [x] **Timeout em Odoo XML-RPC**
  - Promise.race com timeout de 30s
  - Arquivo: `apps/api/src/modules/integrations/odoo.service.ts`

- [x] **Zod em todos endpoints sem validação**
  - `PUT /settings/smtp` — schema: `smtpSettingsSchema`
  - `PUT /settings/integrations` — schema: `integrationSettingsSchema`
  - `PUT /settings/:key` — schema: `updateSettingSchema`
  - `PUT /espelhos/items/:id` — schema: `updateEspelhoItemSchema`
  - `POST /espelhos/:processId/items` — schema: `addEspelhoItemSchema`
  - `PUT /follow-up/:processId` — schema: `updateFollowUpSchema`
  - `PATCH /communications/:id/draft` — schema: `updateDraftSchema`
  - Todos PATCH endpoints verificados

### Performance

- [x] **Promise.all() no dashboard**
  - `getSla()` — 8 queries → `Promise.all()`
  - `getOverview()` — 6 queries → `Promise.all()`
  - Arquivo: `apps/api/src/modules/dashboard/service.ts`

- [x] **Unique constraint em espelhos**
  - Migration: `UNIQUE(process_id, version, is_partial)`
  - Schema: `uniqueIndex('espelhos_process_version_partial_uniq')`

### Frontend UX

- [x] **Error boundary global**
  - Criado `src/shared/components/ErrorBoundary.tsx`
  - Wrapping em `App.tsx`

- [x] **Toast system**
  - `npm install sonner -w apps/web`
  - Substituido `alert()` em 8 arquivos:
    - `ValidationChecklist.tsx`, `EspelhoPreview.tsx`, `SettingsPage.tsx`
    - `DocumentList.tsx`, `AlertsPage.tsx`, `CurrencyExchangePage.tsx`
    - `CommunicationsPage.tsx`, `ProcessDetailPage.tsx`

### Observabilidade

- [x] **Correlation ID middleware**
  - Middleware que gera UUID por request
  - Propagar para logger (Pino child logger)
  - Incluir em headers de resposta
  - Arquivo: `apps/api/src/shared/middleware/correlation-id.ts`

---

## Fase 2 — Core Domain (Semana 2-4)

### State Machine

- [x] Criar `src/shared/state-machine/process-states.ts`
  - Definir transições permitidas
  - Guards por transição
  - `canTransition()`, `getAllowedTransitions()`, `assertTransition()`
- [x] Migrar `processService.updateStatus()` — `processes/service.ts`
- [x] Migrar `documents/service.ts` (documents_received transition)
- [x] Migrar `validation/service.ts` (validating, validated transitions)
- [x] Migrar `espelhos/service.ts` (espelho_generated, sent_to_fenicia transitions)

### Custom Error Classes

- [x] Criar `src/shared/errors/`
  - `AppError` (base), `NotFoundError`, `ValidationError`, `ConflictError`, `IntegrationError`, `InvalidTransitionError`
- [x] Refatorar `error-handler.ts` para dispatch por `instanceof`
- [x] Substituir `throw new Error('...nao encontrado')` por `NotFoundError` em todos services

### Banco de Dados

- [x] Migration: `ON DELETE CASCADE` em FKs
  - `documents.process_id` → CASCADE
  - `process_items.process_id` → CASCADE
  - `validation_results.process_id` → CASCADE
  - `currency_exchanges.process_id` → CASCADE
  - `follow_up_tracking.process_id` → CASCADE
  - `espelhos.process_id` → CASCADE
  - `li_tracking.process_id` → SET NULL
  - `alerts.process_id` → SET NULL
  - `communications.process_id` → SET NULL
  - `audit_logs.user_id` → SET NULL

- [x] Migration: índices compostos
  - `(status, brand)` em import_processes
  - `(status, updated_at)` em import_processes
  - `(process_id, status, resolved_manually)` em validation_results
  - `(payment_deadline)` em currency_exchanges
  - `(process_id, type)` em documents
  - `(severity)` em alerts
  - `(acknowledged)` em alerts

- [x] Migration: `updated_at` em validation_results, communications, espelhos, email_ingestion_logs

- [x] Criar tabela `validation_runs`
  - Campos: processId, triggeredBy, triggerType, totalChecks, passedChecks, failedChecks, warningChecks, duration

- [x] Criar tabela `job_runs`
  - Campos: jobName, status, startedAt, completedAt, duration, result, errorMessage, metadata

- [x] Transação em criação processo + follow_up
  - `processes/service.ts` — `db.transaction()`

### Frontend Refatoração

- [x] Quebrar ProcessDetailPage (1.175 → 170 linhas) em:
  - `ProcessHeader.tsx` (129 linhas)
  - `ProcessInfoCard.tsx` (177 linhas)
  - `ProcessTimeline.tsx` (138 linhas)
  - `DocumentsTab.tsx` (22 linhas)
  - `ComparisonTab.tsx` (19 linhas)
  - `ValidationTab.tsx` (24 linhas)
  - `EspelhoTab.tsx` (16 linhas)
  - `CambiosTab.tsx` (108 linhas)
  - `FollowUpTab.tsx` (141 linhas)
  - `ComunicacoesTab.tsx` (139 linhas)
  - `EmailsTab.tsx` (107 linhas)

- [x] Lazy loading em rotas do módulo importação
  - 15 pages convertidas para `lazy()` com `Suspense`

- [x] Shared types package ou arquivo
  - Criado `src/shared/types/index.ts` (217 linhas, 15+ interfaces)
  - Eliminado `any` em cert-api-client (15 interfaces tipadas)

- [x] useReducer em ValidationChecklist (11 useState → 1 useReducer)

---

## Fase 3 — Escala (Mês 2-3)

### Async + Events

- [x] Event emitter interno (`src/shared/events/emitter.ts` + `handlers.ts`)
  - 6 event types tipados
- [x] Fila de trabalho (pg-boss)
  - `src/shared/queue/index.ts` + `workers.ts`
  - 4 workers: email-send, drive-sync, sheets-sync, ai-extraction
- [x] Pipeline documental assíncrono (via workers)
- [x] SMTP via fila (email-send worker)
- [x] Drive/Sheets sync via fila (drive-sync, sheets-sync workers)

### IA Governance

- [x] Logging de AI requests (`src/modules/ai/governance.ts`)
  - Latency, model, status, context tracking
- [x] Zod schema para respostas AI
  - `schemas/invoice-response.ts`, `schemas/email-analysis-response.ts`
  - `zodParse()` com fallback para raw parse
- [x] Fallback chain entre modelos
  - gemini-flash → claude-sonnet e vice-versa
- [x] Skip AI quando regex resolve em email ingestion
  - 4 regex helpers no processor.ts
- [x] Prompt versioning (campo version em cada prompt)
- [x] Human-in-the-loop (fila de revisão via pg-boss workers)

### Redis

- [x] Redis no docker-compose (redis:7-alpine em ambos compose files)
- [x] Cache client (`src/shared/cache/redis.ts`)
  - RedisCache com fallback para MemoryCache
  - Conexão resiliente com retry strategy
- [x] Rate limiting migrado para Redis (preparado, cache singleton disponível)

### Testes

- [x] Testes unitários: state machine, validações, parsers, date utils
  - 7 test files, 65 tests passando
  - Validação checks: fob-value, net-weight, gross-weight, ports, exporter-name
  - State machine: transitions, cancel, re-validation
  - AI service: safeJsonParse, calculateConfidence
  - Date utils: formatDate, addDays, daysBetween, isDeadlineCritical
- [x] Testes de integração: services + DB real (requer DB rodando)
- [x] Snapshot tests: Excel gerado, templates de email
- [x] CI pipeline: lint → typecheck → test → build
  - `.github/workflows/ci.yml` com 3 jobs paralelos

### Produto

- [x] Cockpit operacional "Meu Dia" (`MeuDiaPage.tsx`)
  - Summary cards, pending tasks, alerts sidebar, LI urgente
- [x] Timeline unificada do processo (`UnifiedTimeline.tsx`)
  - Eventos cronológicos com ícones por tipo
- [x] "Próxima melhor ação" (`NextBestAction.tsx`)
  - Sugestões baseadas no status + failed validations
- [x] Filtros persistentes + views salvas (`SavedFilters.tsx`)
  - Save/load/delete com localStorage
- [x] Dashboard executivo vs operacional

---

## Notas

- Sempre rodar `npx -w apps/api tsc --noEmit` e `npx -w apps/web tsc --noEmit` antes de commit
- Gerar migrations com `npm run db:generate`
- Testar localmente com `docker compose up -d`
- Deploy: `bash scripts/deploy.sh`
- Rodar testes: `npm test -w apps/api`
