# TODO — Plano de Execução

**Criado em**: 2026-03-12
**Referência**: [Diagnóstico Técnico Completo](./diagnostico-tecnico-completo.md)

---

## Fase 1 — Quick Wins (Dia 1-2)

### Segurança (Prioridade Máxima)

- [ ] **helmet()** no Express
  - `npm install helmet -w apps/api`
  - Adicionar `app.use(helmet())` em `apps/api/src/app.ts`
  - Arquivo: `apps/api/src/app.ts`

- [ ] **Auth no cert-api** (JWT ou API key)
  - Adicionar middleware de API key no FastAPI
  - Restringir CORS para domínios específicos
  - Arquivo: `apps/cert-api/main.py:44-49`

- [ ] **USER node nos Dockerfiles**
  - Adicionar `USER node` em `apps/api/Dockerfile`
  - Adicionar `USER nginx` em `apps/web/Dockerfile`
  - Adicionar `USER nobody` em `apps/cert-api/Dockerfile`

- [ ] **Rate limiting em `/auth/google`**
  - Adicionar `createRateLimiter(10, 15 * 60 * 1000)` na rota
  - Arquivo: `apps/api/src/modules/auth/routes.ts:11`

- [ ] **DOMPurify no frontend**
  - `npm install dompurify @types/dompurify -w apps/web`
  - Sanitizar antes de `dangerouslySetInnerHTML`
  - Arquivo: `apps/web/src/features/validation/ValidationChecklist.tsx:476`

- [ ] **Magic-byte check em uploads**
  - `npm install file-type -w apps/api`
  - Validar magic bytes no middleware de upload
  - Arquivo: `apps/api/src/shared/middleware/upload.ts:32-33`

- [ ] **Remover xlsx de CDN externa**
  - Substituir URL do SheetJS por versão npm
  - Arquivo: `apps/api/package.json:34`

### Resiliência

- [ ] **AbortController com timeout 60s** em chamadas AI
  - Envolver `fetch()` com `AbortSignal.timeout(60000)`
  - Arquivo: `apps/api/src/modules/ai/service.ts:51`

- [ ] **Timeout em Odoo XML-RPC**
  - Configurar timeout no client XML-RPC
  - Arquivo: `apps/api/src/modules/integrations/odoo.service.ts`

- [ ] **Zod em todos endpoints sem validação**
  - `PUT /settings/smtp` — `settings/controller.ts:83`
  - `PUT /settings/integrations` — `settings/controller.ts:101`
  - `PUT /settings/:key` — `settings/controller.ts:64`
  - `PUT /espelhos/items/:id` — `espelhos/controller.ts:39`
  - `POST /espelhos/:processId/items` — `espelhos/controller.ts:48`
  - `PUT /follow-up/:processId` — `follow-up/controller.ts:28`
  - Todos PATCH endpoints

### Performance

- [ ] **Promise.all() no dashboard**
  - `getSla()` — 8 queries → `Promise.all()`
  - `getOverview()` — 6 queries → `Promise.all()`
  - Arquivo: `apps/api/src/modules/dashboard/service.ts:6-51, 82-229`

- [ ] **Unique constraint em espelhos**
  - Migration: `UNIQUE(process_id, version, is_partial)`
  - Gerar com `npx drizzle-kit generate`

### Frontend UX

- [ ] **Error boundary global**
  - Criar `src/shared/components/ErrorBoundary.tsx`
  - Wrapping em `App.tsx`

- [ ] **Toast system**
  - `npm install sonner -w apps/web`
  - Substituir `alert()` em:
    - `ValidationChecklist.tsx`
    - `EspelhoPreview.tsx`
    - `SettingsPage.tsx`

### Observabilidade

- [ ] **Correlation ID middleware**
  - Middleware que gera UUID por request
  - Propagar para logger (Pino child logger)
  - Incluir em headers de resposta
  - Arquivo: `apps/api/src/app.ts`

---

## Fase 2 — Core Domain (Semana 2-4)

### State Machine

- [ ] Criar `src/shared/state-machine/process-states.ts`
  - Definir transições permitidas
  - Guards por transição
  - Hooks pós-transição (audit log, eventos)
- [ ] Migrar `processService.updateStatus()` — `processes/service.ts:97-106`
- [ ] Migrar `documents/service.ts:67`
- [ ] Migrar `validation/service.ts:61, 110, 121`
- [ ] Migrar `espelhos/service.ts:101, 407`

### Custom Error Classes

- [ ] Criar `src/shared/errors/`
  - `AppError` (base), `NotFoundError`, `ValidationError`, `ConflictError`, `IntegrationError`
- [ ] Refatorar `error-handler.ts` para dispatch por `instanceof`
- [ ] Eliminar string matching em controllers

### Banco de Dados

- [ ] Migration: `ON DELETE CASCADE` em FKs
  - `documents.process_id`
  - `process_items.process_id`
  - `validation_results.process_id`
  - `currency_exchanges.process_id`
  - `follow_up_tracking.process_id`
  - `espelhos.process_id`
  - `li_tracking.process_id`
  - `alerts.process_id` → `SET NULL`
  - `communications.process_id` → `SET NULL`
  - `audit_logs.user_id` → `SET NULL`

- [ ] Migration: índices compostos
  - `(status, brand)` em import_processes
  - `(status, updated_at)` em import_processes
  - `(process_id, status, resolved_manually)` em validation_results
  - `(payment_deadline)` em currency_exchanges
  - trigram GIN em `process_code`
  - `(process_id, type)` em documents
  - `(severity)` em alerts
  - `(acknowledged)` em alerts

- [ ] Migration: `updated_at` em validation_results, communications, espelhos, email_ingestion_logs

- [ ] Criar tabela `validation_runs`
  - Migrar `validation/service.ts` para inserir run antes de results

- [ ] Criar tabela `job_runs`
  - Wrapper de job execution com logging automático

- [ ] Transação em criação processo + follow_up
  - `processes/service.ts:59-83`
  - `processor.ts:257-265`

### Frontend Refatoração

- [ ] Quebrar ProcessDetailPage (1.175 linhas) em:
  - `ProcessHeader.tsx`
  - `ProcessInfoCard.tsx`
  - `ProcessTimeline.tsx`
  - `DocumentsTab.tsx`
  - `ComparisonTab.tsx`
  - `ValidationTab.tsx`
  - `EspelhoTab.tsx`
  - `CambiosTab.tsx`
  - `FollowUpTab.tsx`

- [ ] Lazy loading em rotas do módulo importação
  - `apps/web/src/app/routes.tsx`

- [ ] Shared types package ou arquivo
  - Extrair interfaces duplicadas
  - Eliminar `any` em cert-api-client

- [ ] useReducer em ValidationChecklist (11 useState)

---

## Fase 3 — Escala (Mês 2-3)

### Async + Events

- [ ] Event emitter interno
- [ ] Fila de trabalho (BullMQ ou pg-boss)
- [ ] Pipeline documental assíncrono
- [ ] SMTP via fila
- [ ] Drive/Sheets sync via fila

### IA Governance

- [ ] Tabela `ai_requests`
- [ ] Zod schema para respostas AI
- [ ] Fallback chain entre modelos
- [ ] Skip AI quando regex resolve em email ingestion
- [ ] Prompt versioning (campo version em cada prompt)
- [ ] Human-in-the-loop (fila de revisão)

### Redis

- [ ] Redis no docker-compose
- [ ] Rate limiting migrado para Redis
- [ ] Cache de queries pesadas do dashboard

### Testes

- [ ] Testes unitários: state machine, validações, parsers, date utils
- [ ] Testes de integração: services + DB real
- [ ] Snapshot tests: Excel gerado, templates de email
- [ ] CI pipeline: lint → typecheck → test → build

### Produto

- [ ] Cockpit operacional "Meu Dia"
- [ ] Timeline unificada do processo
- [ ] "Próxima melhor ação"
- [ ] Filtros persistentes + views salvas
- [ ] Dashboard executivo vs operacional

---

## Notas

- Sempre rodar `npx -w apps/api tsc --noEmit` e `npx -w apps/web tsc --noEmit` antes de commit
- Gerar migrations com `npm run db:generate`
- Testar localmente com `docker compose up -d`
- Deploy: `bash scripts/deploy.sh`
