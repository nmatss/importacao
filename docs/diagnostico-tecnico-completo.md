# Diagnóstico Técnico Completo — Sistema de Importação

**Data**: 2026-03-12
**Método**: Análise direta do código-fonte por 5 agentes especializados (100+ arquivos auditados)
**Escopo**: Arquitetura, backend, frontend, banco de dados, segurança, IA, jobs, observabilidade, DevEx

---

## Sumário

- [1. Resumo Executivo](#1-resumo-executivo)
- [2. Diagnóstico por Área](#2-diagnóstico-por-área)
  - [2.1 Arquitetura](#21-arquitetura-e-design)
  - [2.2 Banco de Dados](#22-banco-de-dados)
  - [2.3 Backend e APIs](#23-backend-e-apis)
  - [2.4 Jobs e Cron](#24-jobs-e-cron)
  - [2.5 IA](#25-ia-no-sistema)
  - [2.6 Gestão Documental](#26-gestão-documental)
  - [2.7 Espelhos](#27-espelhos)
  - [2.8 Emails e Alertas](#28-emails-comunicações-e-alertas)
  - [2.9 Frontend](#29-frontend-e-ux)
  - [2.10 Segurança](#210-segurança)
  - [2.11 Observabilidade](#211-observabilidade)
  - [2.12 DevEx](#212-devex-e-qualidade)
- [3. Lista Completa de Oportunidades](#3-lista-completa-de-oportunidades)
- [4. Quick Wins](#4-quick-wins)
- [5. Melhorias Estruturais](#5-melhorias-estruturais)
- [6. Matriz Impacto x Esforço](#6-matriz-impacto--esforço)
- [7. Roadmap Técnico](#7-roadmap-técnico)
- [8. Top 10 Recomendações](#8-top-10-recomendações)
- [Plano A: Refatoração Arquitetural](#a-plano-de-refatoração-arquitetural)
- [Plano B: Endurecimento Operacional](#b-plano-de-endurecimento-operacional)
- [Plano C: Governança de IA](#c-plano-de-governança-de-ia)
- [Plano D: Melhoria de UX](#d-plano-de-melhoria-de-ux-operacional)

---

# 1. Resumo Executivo

## Estado Atual

Sistema em produção com cobertura funcional acima da média: 15 módulos backend, 96+ endpoints, 24 páginas frontend, 15 tabelas, 8 integrações externas, IA aplicada em 5 pontos de alto valor, e um microsserviço Python independente para certificações. Deploy automatizado com Docker Compose + Vault.

## Principais Forças

- **Domínio bem modelado** — workflow de processo explícito com 9 estados, 26 validações automatizadas, 7 marcos de follow-up
- **IA aplicada com inteligência** — classificação 3-camadas em email, extração documental, drafts de correção
- **Integrações reais** — Google Suite, Odoo, SMTP, VTEX — não são protótipos
- **Auditoria presente** desde o início — `audit_logs` em operações críticas
- **Deduplicação de emails funcional** — por `messageId`, com reprocessamento manual
- **Controllers thin e consistentes** — `sendSuccess/sendError/sendPaginated` em toda API
- **cert-api bem isolado** — SSE, APScheduler, relatórios Excel, histórico de runs

## Principais Riscos (validados no código)

| # | Risco | Severidade | Evidência |
|---|-------|-----------|-----------|
| 1 | **Sem state machine formal** — `updateStatus()` aceita qualquer string, cast `as any` | CRÍTICO | `processes/service.ts:99` |
| 2 | **cert-api sem autenticação e CORS `*`** | CRÍTICO | `main.py:44-49` |
| 3 | **Containers rodam como root** | ALTO | Todos os Dockerfiles |
| 4 | **Upload valida MIME do client, não magic bytes** | ALTO | `upload.ts:32-33` |
| 5 | **Sem timeout em chamadas AI/Odoo** — hang indefinido | ALTO | `ai/service.ts:51`, `odoo.service.ts` |
| 6 | **Sem validação de schema nas respostas da IA** | ALTO | `ai/service.ts:126-154` |
| 7 | **`dangerouslySetInnerHTML` com conteúdo gerado por IA** | ALTO | `ValidationChecklist.tsx:476` |
| 8 | **xlsx carregado de CDN externa, não npm** — supply chain | ALTO | `package.json:34` |
| 9 | **Sem error boundaries no React** — crash = tela branca | ALTO | Nenhum `ErrorBoundary` encontrado |
| 10 | **God methods** — `runAllChecks()` 188 linhas, 8 side effects | MÉDIO | `validation/service.ts:16-203` |

## Principais Oportunidades

- Formalizar state machine do processo (impacto imediato em integridade)
- Adicionar timeouts + fallback na IA (impacto imediato em resiliência)
- Error boundaries + toast system no frontend (impacto imediato em UX)
- `job_runs` table + correlation IDs (impacto imediato em observabilidade)
- Versionamento de documentos e validações (impacto em auditabilidade)
- Cockpit operacional diário (impacto em produtividade)

---

# 2. Diagnóstico por Área

## 2.1 Arquitetura e Design

### Pontos Fortes
- Sem dependências circulares — uso inteligente de `import()` dinâmico para evitar ciclos
- `audit` como cross-cutting concern universal — correto
- `dashboard/service.ts` sem imports de módulos — queries puras contra schema

### Grafo de Dependências entre Módulos

```
processes/service.ts       --> audit
documents/service.ts       --> ai, alerts, integrations/google-drive, integrations/google-sheets,
                               currency-exchange, validation, audit
validation/service.ts      --> ai, alerts, communications, integrations/google-drive,
                               alerts/google-chat, audit
espelhos/service.ts        --> alerts, audit, integrations/google-sheets, communications
email-ingestion/processor  --> documents, ai, audit, integrations/google-drive
communications/service.ts  --> ai, communications/templates, audit
alerts/service.ts          --> alerts/google-chat, audit
follow-up/service.ts       --> integrations/google-sheets
dashboard/service.ts       --> (apenas shared DB schema)
```

### Problemas/Riscos

- **`documents/service.ts` é o módulo mais acoplado** (7 dependências). Um upload dispara: AI extraction → validation → alerts → Drive → Sheets → communications. Cascade de 6+ chamadas externas em um request.
- **`validation/service.ts` é o segundo hub** (6 dependências). `runAllChecks()` é um god method com 188 linhas e 8 side effects (status update, delete+insert results, Drive upload, alerts, email drafts, Google Chat, folder moves).
- **Zero dependency injection.** Todos os services são singletons importados diretamente. Impossível testar isoladamente.
- **Sem sistema de filas/workers.** Toda I/O externa (AI, Drive, SMTP, Sheets, Chat) roda síncrono no request ou fire-and-forget sem garantia.
- **Lock de concorrência é boolean in-memory** (`isRunning` em `email-check.ts:3`) — reseta no restart, não coordena múltiplas instâncias.

### Melhorias Recomendadas

1. Extrair orchestration de `documents/service.ts` e `validation/service.ts` em application services separados
2. Implementar event emitter interno (ou outbox pattern) para desacoplar side effects
3. Adotar fila para operações assíncronas (Drive upload, Sheets sync, SMTP, Chat webhook)
4. Usar DI container leve (tsyringe ou awilix) para testabilidade

---

## 2.2 Banco de Dados

### Pontos Fortes
- 15 tabelas com enums tipados — modelo coerente
- `follow_up_tracking` com 7 marcos explícitos + progress %
- `processCode` com unique constraint
- Migrações Drizzle rastreadas

### Problemas de Integridade

- **Todos os FKs usam `ON DELETE no action`** — deletar um processo orphana documents, items, validation_results, currency_exchanges, etc. Mitigado por soft delete (`status=cancelled`), mas frágil.
- **Criação de processo + follow_up não é transacional** — se follow_up insert falha, processo fica sem tracking. (`processes/service.ts:59-83`, `processor.ts:257-265`)
- **`espelhos(process_id, version, is_partial)` sem unique constraint** — race condition pode duplicar versões
- **`correction_status` é varchar(30) livre** em vez de enum. Valores hardcoded em `validation/service.ts:107,134`

### Unique Constraints Ausentes

- `process_items(process_id, item_code, color, size)` — permite itens duplicados
- `espelhos(process_id, version, is_partial)` — race condition em versões
- `li_tracking(process_code, ncm, item)` — permite LIs duplicadas

### Check Constraints Ausentes

- `follow_up_tracking.overall_progress` — `CHECK (BETWEEN 0 AND 100)`
- `currency_exchanges.amount_usd` — `CHECK (> 0)`
- `documents.confidence_score` — `CHECK (BETWEEN 0 AND 1)`
- `import_processes.total_fob_value` — `CHECK (>= 0)`

### Índices Compostos Necessários

| Índice | Query beneficiada | Arquivo |
|---|---|---|
| `(status, brand)` | `processService.list()` | `processes/service.ts:9-34` |
| `(status, updated_at)` | Dashboard + stalled-process job | `dashboard/service.ts:16-18` |
| `(process_id, status, resolved_manually)` em validation_results | Dashboard `withDivergences` | `dashboard/service.ts:119-134` |
| `(payment_deadline)` em currency_exchanges | Dashboard `upcomingPayments` | `dashboard/service.ts:194-208` |
| trigram GIN em `process_code` | ILIKE com `%search%` | `processes/service.ts:18` |
| `(process_id, type)` em documents | Validação + listagem | `validation/service.ts:37-41` |
| `(severity)`, `(acknowledged)` em alerts | Filtros de alertas | |
| `(entity_type, entity_id)` em audit_logs | Filtros de auditoria | `audit/service.ts:40-72` |

### JSONB que Deveria Ser Normalizado

| Campo | Problema | Recomendação |
|---|---|---|
| `espelhos.generated_data` | Acessado via `as any` cast | Normalizar em colunas: `file_path`, `filename`, `item_count` |
| `email_ingestion_logs.processed_attachments` | Esconde relação documents↔emails sem FK | Join table `email_attachment_documents` |
| `import_processes.ai_extracted_data` | Duplica dados de `documents.ai_parsed_data` | Remover duplicação |
| `import_processes.payment_terms` | Dados estruturados simples | Colunas: `payment_deposit_percent`, `payment_balance_percent` |

### Versionamento Ausente

- `validation_results` são **deletados e recriados** a cada run — zero histórico. Precisa de tabela `validation_runs`.
- `documents.ai_parsed_data` é **sobrescrito** no reprocessamento — sem histórico de extrações.
- Sem tabela `ai_extractions` para rastreabilidade.

### Timestamps Faltando

| Tabela | Falta |
|---|---|
| `validation_results` | `updated_at` |
| `communications` | `updated_at` |
| `espelhos` | `updated_at` |
| `email_ingestion_logs` | `updated_at` |
| `system_settings` | `created_at` |

### Performance de Queries

- **Dashboard `getSla()`**: 8 queries sequenciais sem `Promise.all()` — `dashboard/service.ts:82-229`
- **Dashboard `getOverview()`**: 6 queries sequenciais — `dashboard/service.ts:6-51`
- **Stalled-process job**: N+1 — busca todos, depois 1 query por processo — `stalled-process.ts:10-34`
- **`fuzzyMatchProcessCode()`**: até 4 queries sequenciais por email — `processor.ts:114-146`
- **ILIKE sem trigram index**: `%search%` derrota B-tree — `processes/service.ts:18`
- **Sem materialized views** para agregações de dashboard

### Integridade de Dados

- **Document deletion não limpa `ai_extracted_data`** — `documents/service.ts:262-276` remove registro mas deixa dados stale no JSONB do processo
- **`li_tracking.process_code` é denormalização** — se código muda, LI tracking fica stale
- **Seed com senha hardcoded `admin123`** e sem idempotência — `seed.ts:8`

---

## 2.3 Backend e APIs

### Pontos Fortes
- Controllers thin em todos os módulos — zero lógica de negócio
- `sendSuccess/sendError/sendPaginated` uniformes
- ZodError tratado globalmente com detalhes por campo
- Email ingestion com deduplicação robusta por `messageId`
- Alertas com deduplicação 24h por `processId + title`

### State Machine — FINDING CRÍTICO

**Não existe state machine formal.** Status transitions estão espalhados em 4 arquivos sem guards.

| Arquivo | Linha | Transição |
|---|---|---|
| `documents/service.ts` | 67 | `* -> documents_received` |
| `validation/service.ts` | 61 | `* -> validating` |
| `validation/service.ts` | 110, 121 | `* -> validated` |
| `espelhos/service.ts` | 101 | `* -> espelho_generated` |
| `espelhos/service.ts` | 407 | `* -> sent_to_fenicia` |
| `processes/service.ts` | 99 | `* -> (qualquer string)` via `as any` |
| `processes/service.ts` | 110 | `* -> cancelled` |

**`processService.updateStatus()` aceita qualquer string como status com cast `as any`.** Possível ir de `draft` direto para `completed` ou setar `"banana"` como status. Nenhuma transição é validada.

### Erros

- **Sem classes de erro customizadas.** Detecção por string matching: `error.message.includes('nao encontrado')` em `espelhos/controller.ts:42,60,76`. Frágil.
- Todos os erros defaultam para **status 400**. Erros de DB vazam para o client.
- Global error handler é dead code — controllers capturam antes.

### Endpoints sem Validação Zod

- `PUT /settings/smtp` — `settings/controller.ts:83`
- `PUT /settings/integrations` — `settings/controller.ts:101`
- `PUT /settings/:key` — `settings/controller.ts:64`
- `PUT /espelhos/items/:id` — `espelhos/controller.ts:39`
- `POST /espelhos/:processId/items` — `espelhos/controller.ts:48`
- `PUT /follow-up/:processId` — `follow-up/controller.ts:28`
- Todos endpoints de AI, todos PATCH endpoints

### Idempotência Ausente

- Re-run de validação cria duplicatas de: email drafts, Drive uploads, Google Chat messages
- Upload duplicado do mesmo arquivo = 2 registros + 2 cópias no Drive
- Geração de espelho cria nova versão a cada chamada sem guard
- Comunicações sem check de duplicata

### Rate Limiting

- Apenas **2 de ~15 grupos** protegidos (login: 5/15min, AI: 30/min)
- In-memory Map, reseta no restart, single-instance only
- Upload, validation, espelho, email trigger — desprotegidos

---

## 2.4 Jobs e Cron

### Pontos Fortes
- 4 jobs bem definidos com timezone correto (America/Sao_Paulo)
- Email dedup funcional (via DB `messageId`)
- Alert dedup funcional (via `hasDuplicateRecent` 24h)

### Problemas

| Problema | Impacto |
|---|---|
| Sem tabela `job_runs` | Zero visibilidade sobre execução |
| Erros logados mas nunca alertados | Job failure silencioso |
| Sem retry automático | Falha transiente espera próximo schedule |
| Lock in-memory (boolean) | Não sobrevive restart |
| Deadline/stalled sem concurrency control | Overlap possível |
| Stalled-process é N+1 | Performance degradada |
| Sem trigger manual para deadline/stalled | Debugging difícil |
| cert-api: state in-memory | Restart perde runs em andamento |

---

## 2.5 IA no Sistema

### Pontos Fortes
- Prompts organizados em arquivos separados (`ai/prompts/*.ts`)
- Fallback graceful no email ingestion — AI failure não bloqueia
- Confidence score calculado por campo
- `safeJsonParse` com log de resposta truncada

### Problemas

| Finding | Severidade | Local |
|---|---|---|
| **Sem timeout no fetch** | ALTO | `ai/service.ts:51` |
| **Sem validação de schema na resposta** | ALTO | `ai/service.ts:126-154` |
| **Sem cost tracking** | MÉDIO | (ausente) |
| **Sem fallback entre modelos** | MÉDIO | Model down = feature down |
| **Prompts não versionados** | MÉDIO | Sem version ID |
| **Confidence self-assessed** | MÉDIO | AI atribui própria confiança |
| **AI roda em todo email** | MÉDIO | Mesmo quando regex resolve |
| **NCM prompt hardcoded inline** | BAIXO | `ai/service.ts:230-255` |
| **Sem logging de input/output** | BAIXO | Só `messageCount` + `responseLength` |
| **Sem rate limiting outbound** | MÉDIO | Burst pode bater rate limit do OpenRouter |

---

## 2.6 Gestão Documental

### Problemas
- Sem versionamento — reprocessar sobrescreve `ai_parsed_data`
- Sem deduplicação por hash — mesmo PDF 2x = 2 registros
- Deleção não cascadeia para `ai_extracted_data` do processo
- MIME validation apenas (sem magic-byte)
- 50MB processado no mesmo request (PDF parse + AI + Drive)

### Pipeline Recomendado

```
upload → persist metadata → queue → parse PDF/Excel → AI extraction
→ normalização → cross-doc reconciliation → persist results
→ Drive upload → trigger validation
```

---

## 2.7 Espelhos

### Problemas
- Race condition na version (sem unique constraint)
- `generated_data` JSONB acessado via `as any`
- Sem guard para gerar em processo completado/cancelado
- Envio Drive/Fenicia síncrono no request

---

## 2.8 Emails, Comunicações e Alertas

### Problemas
- AI roda em todo email mesmo quando regex resolve — custo desnecessário
- Drive file move fire-and-forget com `catch(() => {})` — falha silenciosa
- SMTP síncrono — request espera envio
- Sem thread intelligence — emails isolados
- Sem retry automático para emails failed
- Alertas sem ownership/assignment

---

## 2.9 Frontend e UX

### Pontos Fortes
- React Query com config global sensata (retry:1, staleTime:30s)
- AuthContext bem estruturado com `useCallback`
- Portal com health check das APIs
- Certificações com lazy loading

### Problemas

| Finding | Severidade | Local |
|---|---|---|
| **Zero error boundaries** — crash = tela branca | ALTO | Nenhum `ErrorBoundary` |
| **`dangerouslySetInnerHTML` com conteúdo AI** — XSS | ALTO | `ValidationChecklist.tsx:476` |
| **ProcessDetailPage: 1.175 linhas** | ALTO | God component |
| **`alert()` para feedback** | MÉDIO | ValidationChecklist, EspelhoPreview, Settings |
| **40+ usos de `any`** | MÉDIO | cert-api, error catches |
| **Sem lazy loading módulo importação** | MÉDIO | Bundle eager |
| **Sem types compartilhados** | MÉDIO | Interfaces inline duplicadas |
| **Zero `useMemo`/`React.memo`** | MÉDIO | Re-renders desnecessários |
| **11 `useState` em ValidationChecklist** | MÉDIO | Pede `useReducer` |
| **Acessibilidade pobre** | BAIXO | Sem focus trap, htmlFor, aria-labels |
| **`window.location.href` no 401** | BAIXO | Bypassa React Router |
| **Schemas zod duplicados** Create/Edit | BAIXO | DRY violation |

### Outros achados
- **cert-api-client sem auth** — `cert-api-client.ts:3`
- **SSE silently fails** — `cert-api-client.ts:79-81`
- **Sem token refresh** — JWT expira = login imediato
- **Sem 404 page** — redireciona para `/portal`
- **Labels sem `htmlFor`** em formulários
- **`<tr onClick>` sem keyboard handler** — `DashboardPage.tsx:693`

---

## 2.10 Segurança

### Findings Críticos/Altos

| # | Finding | Severidade | Local |
|---|---------|-----------|-------|
| 1 | **cert-api: zero auth + CORS `*`** | CRÍTICO | `main.py:44-49` |
| 2 | **Containers rodam como root** | ALTO | Todos Dockerfiles |
| 3 | **Upload: MIME-only, sem magic bytes** | ALTO | `upload.ts:32-33` |
| 4 | **Endpoints sem Zod validation** | ALTO | espelhos, follow-up, settings, AI |
| 5 | **`/auth/google` sem rate limiting** | ALTO | `auth/routes.ts:11` |
| 6 | **xlsx de CDN externa** — supply chain | ALTO | `package.json:34` |
| 7 | **Sem security headers** (helmet/CSP/HSTS) | ALTO | `app.ts` |
| 8 | **DB password default em prod compose** | MÉDIO | `docker-compose.prod.yml:8` |
| 9 | **Postgres exposto porta 5450** | MÉDIO | `docker-compose.prod.yml:10` |
| 10 | **JWT sem algorithm explícito** | MÉDIO | `auth/service.ts:33-36` |
| 11 | **Password policy: 6 chars mínimo** | MÉDIO | `auth/schema.ts:11` |
| 12 | **Seed com senha hardcoded** | MÉDIO | `seed.ts:8` |
| 13 | **Docker images não pinadas** | MÉDIO | Todos Dockerfiles |
| 14 | **Sem network isolation** entre containers | MÉDIO | `docker-compose.prod.yml` |
| 15 | **Sem resource limits** (CPU/memory) | MÉDIO | `docker-compose.prod.yml` |

### Positivos
- SQL injection: Drizzle ORM usado consistentemente, zero SQL raw concatenado
- Filenames com UUID: sem path traversal
- CORS na API principal: configurável por env var
- Vault integration: sólida, com chmod 600
- Graceful shutdown implementado
- 500 errors: stack trace não vaza para client

---

## 2.11 Observabilidade

### Estado Atual
- Pino logger com structured JSON — bom
- Audit logs em operações críticas — bom
- `/health` retorna apenas timestamp — insuficiente

### Ausente
- Correlation ID / request ID
- Métricas (Prometheus/etc)
- Tracing distribuído
- Health checks de dependências
- `job_runs` table
- Alerting em job failure
- Response time logging

---

## 2.12 DevEx e Qualidade

### Estado Atual
- Monorepo npm workspaces funcional
- TypeScript compilação limpa
- Docker Compose dev e prod separados
- Scripts operacionais existentes

### Ausente
- **Zero testes automatizados**
- Sem CI/CD pipeline
- Sem contratos compartilhados frontend/backend
- Sem `npm audit` no workflow
- Sem lint/format enforcement

---

# 3. Lista Completa de Oportunidades

## Arquitetura (8)
1. State machine formal para processo
2. Event emitter / outbox para desacoplar side effects
3. Fila de trabalho para operações assíncronas
4. DI container para testabilidade
5. Separar orchestration de services de domínio
6. Contrato formal cert-api ↔ frontend
7. Modularização por bounded context
8. Circuit breaker para integrações

## Banco de Dados (13)
9. ON DELETE CASCADE em FKs de children
10. Transação na criação processo + follow_up
11. Unique constraint em espelhos version
12. Correction_status como enum
13. 7+ índices compostos ausentes
14. Trigram GIN para search
15. updated_at em 4 tabelas
16. Normalizar espelhos.generated_data
17. Normalizar email_ingestion_logs.processed_attachments
18. Tabela validation_runs
19. Versionamento de documents
20. Check constraints (progress, amounts, confidence)
21. Remover duplicação ai_extracted_data

## Backend (12)
22. Custom error classes
23. Zod em todos os endpoints com body
24. Promise.all no dashboard
25. Idempotency keys em side effects
26. Redis rate limiting
27. Timeouts em todas as chamadas externas (AI, Odoo, Drive)
28. Corrigir N+1 em stalled-process e fuzzyMatch
29. Rate limiting no Google OAuth
30. Odoo session re-auth automática
31. Pagination em getSla sub-queries
32. Status code correto por tipo de erro
33. Correlation ID em requests

## IA (8)
34. AbortController com timeout 60s
35. Zod validation de respostas AI
36. Tabela ai_requests para rastreabilidade
37. Fallback chain entre modelos
38. Skip AI quando regex resolve
39. Prompt versioning
40. Cost tracking
41. Human-in-the-loop para confidence < 0.7

## Jobs (6)
42. Tabela job_runs
43. Advisory lock para concorrência
44. Trigger manual para todos os jobs
45. Alerting em job failure
46. Retry automático em falhas transientes
47. Cleanup de runs orphanadas (cert-api)

## Frontend (12)
48. Error boundaries global + por feature
49. DOMPurify em dangerouslySetInnerHTML
50. Quebrar ProcessDetailPage
51. Toast system
52. Lazy loading módulo importação
53. Shared API types
54. useReducer em ValidationChecklist
55. Cockpit operacional
56. Timeline unificada do processo
57. "Próxima melhor ação"
58. Filtros persistentes
59. Token refresh flow

## Segurança (10)
60. Auth no cert-api
61. USER não-root nos Dockerfiles
62. helmet() no Express
63. Magic-byte validation
64. Remover xlsx de CDN
65. Security headers (CSP, HSTS)
66. Remover DB password default em prod
67. Fechar porta Postgres em prod
68. Password policy mais forte
69. Pin Docker images por digest

## Observabilidade (5)
70. Correlation ID
71. Health check rico com dependências
72. Métricas básicas
73. Job failure alerting
74. Runbooks para incidentes comuns

## DevEx (5)
75. Pacote shared de types
76. Testes unitários
77. Testes de integração
78. CI pipeline
79. npm audit

**Total: 79 oportunidades identificadas**

---

# 4. Quick Wins

Melhorias de baixo esforço e alto impacto, executáveis em ~1.5 dias:

| # | Ação | Esforço | Impacto |
|---|------|---------|---------|
| 1 | `Promise.all()` nas 8 queries de `getSla()` e 6 de `getOverview()` | 30min | Dashboard 4-8x mais rápido |
| 2 | `AbortController` com timeout 60s nas chamadas AI e Odoo | 1h | Elimina hangs indefinidos |
| 3 | Error boundary global no React (`App.tsx`) | 1h | Elimina tela branca em crash |
| 4 | `helmet()` no Express | 15min | Security headers em toda API |
| 5 | Toast system (sonner/react-hot-toast) substituindo `alert()` | 2h | UX profissional |
| 6 | Rate limiting em `/auth/google` | 15min | Fecha vetor de brute-force |
| 7 | DOMPurify antes de `dangerouslySetInnerHTML` | 30min | Fecha XSS |
| 8 | Correlation ID via middleware | 1h | Rastreabilidade de requests |
| 9 | Zod validation em endpoints sem schema | 2h | Input validation completa |
| 10 | `USER node` nos Dockerfiles | 15min | Containers não-root |
| 11 | Skip AI quando regex resolve + filename classifica | 1h | Redução de custo AI |
| 12 | Unique constraint em `espelhos(process_id, version, is_partial)` | 15min | Elimina race condition |

---

# 5. Melhorias Estruturais

## Médio Prazo (1-4 semanas)
- **State machine formal** — módulo dedicado com transições, guards, hooks, eventos
- **Custom error classes** + error handler refatorado
- **Tabela `job_runs`** + advisory locks + alerting
- **Versionamento de documentos** e `validation_runs`
- **Quebrar ProcessDetailPage** em 6-8 componentes
- **Lazy loading** em todas as rotas
- **Auth no cert-api** (JWT ou API key)
- **Redis rate limiting** (ao menos para AI, upload, admin)
- **Shared types package** entre api e web

## Longo Prazo (1-3 meses)
- **Event system / outbox** para desacoplar side effects
- **Fila de trabalho** (BullMQ/pg-boss) para operações assíncronas
- **Pipeline documental** (upload → parse → AI → validate → index)
- **Cockpit operacional** com inbox de pendências
- **AI governance**: prompt versioning, cost tracking, tabela ai_requests, fallback chain
- **Testes em camadas**: unit → integration → contract → snapshot
- **CI/CD pipeline** completo
- **Observabilidade**: métricas, health checks ricos, tracing

---

# 6. Matriz Impacto x Esforço

| Iniciativa | Impacto | Esforço | Risco | Prioridade |
|---|---|---|---|---|
| State machine formal | **ALTO** | MÉDIO | BAIXO | **P0** |
| Timeouts AI/Odoo | **ALTO** | BAIXO | BAIXO | **P0** |
| Error boundaries React | **ALTO** | BAIXO | BAIXO | **P0** |
| Auth no cert-api | **ALTO** | BAIXO | BAIXO | **P0** |
| helmet() + security headers | **ALTO** | BAIXO | BAIXO | **P0** |
| Promise.all no dashboard | ALTO | BAIXO | BAIXO | **P0** |
| Zod em todos endpoints | ALTO | BAIXO | BAIXO | **P0** |
| Custom error classes | ALTO | MÉDIO | BAIXO | **P1** |
| Tabela job_runs | ALTO | MÉDIO | BAIXO | **P1** |
| Redis rate limiting | ALTO | MÉDIO | BAIXO | **P1** |
| Validation_runs + versioning | ALTO | MÉDIO | BAIXO | **P1** |
| Shared types package | MÉDIO | MÉDIO | BAIXO | **P1** |
| Quebrar ProcessDetailPage | MÉDIO | MÉDIO | BAIXO | **P1** |
| Índices compostos no DB | ALTO | BAIXO | BAIXO | **P1** |
| ON DELETE CASCADE | MÉDIO | BAIXO | MÉDIO | **P1** |
| Event system / outbox | **ALTO** | ALTO | MÉDIO | **P2** |
| Fila de trabalho (BullMQ) | ALTO | ALTO | MÉDIO | **P2** |
| AI governance completa | ALTO | ALTO | BAIXO | **P2** |
| Pipeline documental async | ALTO | ALTO | MÉDIO | **P2** |
| Cockpit operacional | ALTO | ALTO | BAIXO | **P2** |
| Testes em camadas | ALTO | ALTO | BAIXO | **P2** |
| CI/CD pipeline | MÉDIO | ALTO | BAIXO | **P3** |
| Observabilidade completa | MÉDIO | ALTO | BAIXO | **P3** |
| Modularização bounded context | MÉDIO | ALTO | MÉDIO | **P3** |

---

# 7. Roadmap Técnico

## Fase 1 — Hardening (0–30 dias)

### Semana 1-2: Segurança + Resiliência
- [ ] `helmet()` no Express
- [ ] Auth no cert-api (JWT ou API key + CORS restrito)
- [ ] `USER node` nos Dockerfiles
- [ ] Rate limiting em `/auth/google`
- [ ] DOMPurify no `dangerouslySetInnerHTML`
- [ ] Magic-byte check em uploads (package `file-type`)
- [ ] `AbortController` 60s em AI + Odoo
- [ ] Zod em todos endpoints sem validação
- [ ] Remover xlsx de CDN, instalar do npm

### Semana 3-4: Performance + Observabilidade
- [ ] `Promise.all()` no dashboard (getSla + getOverview)
- [ ] Índices compostos prioritários (status+brand, status+updated_at, trigram GIN)
- [ ] Correlation ID middleware
- [ ] Error boundary global no React
- [ ] Toast system substituindo `alert()`
- [ ] Health check rico (DB + OpenRouter + Drive + SMTP)
- [ ] Unique constraint em espelhos version

## Fase 2 — Governança (30–90 dias)

### Mês 2: Core Domain
- [ ] State machine formal para processo
- [ ] Custom error classes (NotFoundError, ValidationError, IntegrationError)
- [ ] Tabela `validation_runs` — historicizar em vez de deletar
- [ ] Tabela `job_runs` + advisory locks + failure alerting
- [ ] Versionamento de documents (version + supersedes_id)
- [ ] ON DELETE CASCADE nas FKs appropriate
- [ ] Transação na criação processo + follow_up

### Mês 3: Frontend + Types
- [ ] Shared types package (`packages/types`)
- [ ] Quebrar ProcessDetailPage em 6-8 componentes
- [ ] Lazy loading em todo módulo importação
- [ ] useReducer em ValidationChecklist
- [ ] Redis rate limiting (AI, upload, admin)
- [ ] Odoo session re-auth automática
- [ ] Skip AI quando regex resolve

## Fase 3 — Escala (90–180 dias)

### Mês 4-5: Async + Events
- [ ] Event emitter / outbox pattern
- [ ] Fila de trabalho (BullMQ ou pg-boss)
- [ ] Pipeline documental assíncrono
- [ ] SMTP assíncrono via fila
- [ ] Drive/Sheets sync via fila

### Mês 5-6: Produto + IA + Qualidade
- [ ] Cockpit operacional (inbox de pendências, ações do dia)
- [ ] AI governance: tabela ai_requests, prompt versioning, cost tracking, fallback chain
- [ ] Testes unitários para state machine, validações, parsers
- [ ] Testes de integração para services + DB
- [ ] CI pipeline (typecheck → test → build → audit)
- [ ] Timeline unificada do processo
- [ ] Métricas básicas (request latency, error rate, AI cost)

---

# 8. Top 10 Recomendações

| # | Recomendação | Justificativa |
|---|---|---|
| **1** | **State machine formal para processo** | `updateStatus()` aceita qualquer string com `as any`. Maior risco de integridade. Sem isso, qualquer bug pode colocar processo em estado impossível. |
| **2** | **Timeouts em todas as chamadas externas** | Fetch sem timeout para OpenRouter e XML-RPC para Odoo podem travar indefinidamente. Request travado nunca retorna. |
| **3** | **Auth no cert-api + fechar CORS** | Qualquer pessoa na rede acessa todos os endpoints. Zero autenticação + CORS `*`. Vetor mais aberto. |
| **4** | **Error boundaries + toast system** | Erro de render crasha app inteiro (tela branca). Feedback via `alert()`. Duas mudanças simples que transformam a experiência. |
| **5** | **Zod em todos endpoints + custom errors** | ~15 endpoints aceitam `req.body` cru. Erros detectados por string matching em português. |
| **6** | **Promise.all no dashboard + índices** | 14 queries sequenciais. Índices ausentes. Paralelizar + indexar = 5-10x mais rápido. |
| **7** | **Tabela `job_runs` + correlation ID** | Não há como saber se job rodou, quanto durou, ou se falhou. Requests sem ID. Debugging cego. |
| **8** | **Versionamento de documentos e validações** | Reprocessar sobrescreve dados. Validação deleta resultados. Zero histórico em operação regulatória. |
| **9** | **Security hardening: helmet, não-root, magic-byte** | Três mudanças de 15 min cada que eliminam vetores reais de ataque. |
| **10** | **Event system para desacoplar side effects** | `runAllChecks()` tem 8 side effects em 188 linhas. Falha no meio = estado parcial. Eventos tornam cada operação atômica. |

---

# Planos de Execução

## A. Plano de Refatoração Arquitetural

### Fase 1: State Machine (1 semana)

```
src/shared/state-machine/
├── process-states.ts      (estados + transições permitidas)
├── state-machine.ts       (engine genérica)
└── guards.ts              (pré-condições por transição)
```

**Transições definidas:**

```typescript
const TRANSITIONS = {
  draft:                ['documents_received', 'cancelled'],
  documents_received:   ['validating', 'cancelled'],
  validating:           ['validated', 'documents_received', 'cancelled'],
  validated:            ['espelho_generated', 'cancelled'],
  espelho_generated:    ['sent_to_fenicia', 'cancelled'],
  sent_to_fenicia:      ['li_pending', 'completed', 'cancelled'],
  li_pending:           ['completed', 'cancelled'],
  completed:            [],
  cancelled:            ['draft'],  // reabrir
};
```

**Guards:**

```typescript
const GUARDS = {
  'documents_received -> validating': (process) =>
    process.documents.filter(d => ['invoice','packing_list','ohbl'].includes(d.type)).length >= 3,
  'validated -> espelho_generated': (process) =>
    process.validationResults.filter(r => r.status === 'failed' && !r.resolvedManually).length === 0,
};
```

**Migração:**
- Substituir todos os `.set({ status })` por `stateMachine.transition(processId, newStatus)`
- Logar transições em `audit_logs` automaticamente
- Emitir evento `process.status.changed` em cada transição

### Fase 2: Custom Errors (3 dias)

```
src/shared/errors/
├── app-error.ts           (base class com statusCode)
├── not-found.ts           (404)
├── validation-error.ts    (400)
├── conflict.ts            (409)
├── integration-error.ts   (502)
└── unauthorized.ts        (401)
```

- Refatorar `error-handler.ts` para dispatch por `instanceof`
- Eliminar string matching em controllers
- Garantir que erros de DB não vazam para client

### Fase 3: Separar Orchestration (2 semanas)

```
documents/
├── service.ts             → domínio puro (CRUD + parse)
├── orchestrator.ts        → upload workflow (AI + Drive + status)
└── handlers/              → event handlers (1 por side effect)

validation/
├── service.ts             → domínio puro (run checks + store)
├── orchestrator.ts        → workflow (alerts + emails + Chat)
└── handlers/              → event handlers
```

### Fase 4: Event System (2-3 semanas)

```
src/shared/events/
├── event-bus.ts           (in-process EventEmitter inicial)
├── outbox.ts              (tabela para durabilidade futura)
└── handlers/
    ├── on-document-uploaded.ts
    ├── on-validation-completed.ts
    ├── on-process-status-changed.ts
    ├── on-espelho-generated.ts
    └── on-alert-created.ts
```

**Eventos definidos:**

| Evento | Emitido por | Handlers |
|---|---|---|
| `document.uploaded` | documents/orchestrator | AI extraction, Drive upload, Sheets sync |
| `document.parsed` | AI handler | Status update, validation trigger |
| `validation.completed` | validation/orchestrator | Alerts, email drafts, Chat, Drive |
| `process.status.changed` | state-machine | Audit, follow-up, Sheets sync |
| `espelho.generated` | espelhos/service | Drive upload, status update |
| `alert.created` | alerts/service | Google Chat webhook |

---

## B. Plano de Endurecimento Operacional

### Semana 1: Observabilidade

```typescript
// Correlation ID middleware
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});
```

```sql
-- Tabela job_runs
CREATE TABLE job_runs (
  id SERIAL PRIMARY KEY,
  job_name VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running', -- running, completed, failed
  attempt INTEGER NOT NULL DEFAULT 1,
  records_processed INTEGER,
  error_summary TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_job_runs_name_status ON job_runs(job_name, status);
```

```typescript
// Health check rico
app.get('/health/ready', async (req, res) => {
  const checks = await Promise.allSettled([
    db.execute(sql`SELECT 1`),           // postgres
    fetch(OPENROUTER_URL, { signal: AbortSignal.timeout(5000) }), // AI
    driveService.isConfigured(),          // Google Drive
    sheetsService.isConfigured(),         // Google Sheets
  ]);
  const results = { postgres, openrouter, drive, sheets };
  const healthy = checks.every(c => c.status === 'fulfilled');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'degraded', checks: results });
});
```

### Semana 2: Resiliência

| Integração | Timeout | Retries | Ação em falha |
|---|---|---|---|
| OpenRouter AI | 60s | 1 (modelo alternativo) | Log + flag `needs_review` |
| Google Drive | 30s | 2 (exponential backoff) | Log + continua sem Drive |
| Google Sheets | 30s | 2 | Log + continua sem sync |
| Odoo XML-RPC | 15s | 1 (re-auth + retry) | Log + skip check |
| SMTP | 30s | 0 (via fila futura) | Mark `failed` + alert |
| Google Chat | 10s | 1 | Log + continua |

```typescript
// Odoo session re-auth
async execute(method, model, args) {
  try {
    return await this._call(method, model, args);
  } catch (err) {
    if (isAuthError(err)) {
      this.uid = null; // invalidate cache
      await this.authenticate();
      return await this._call(method, model, args);
    }
    throw err;
  }
}
```

### Semana 3: Rate Limiting + Security

```typescript
// Redis rate limiter
import { Redis } from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

async function rateLimiter(key, maxAttempts, windowSec) {
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, windowSec);
  return current <= maxAttempts;
}
```

| Endpoint | Limite | Janela |
|---|---|---|
| `/auth/login` | 5 | 15 min |
| `/auth/google` | 10 | 15 min |
| `/ai/*` | 30 | 1 min |
| `/documents/upload` | 10 | 1 min |
| `/settings/*` | 30 | 1 min |
| `/*` (global) | 200 | 1 min |

### Semana 4: Monitoramento

- Métricas HTTP: request count, latency p50/p95/p99, error rate
- Métricas de integração: success/failure rate por serviço
- Métricas de AI: latency, tokens, cost estimate
- Alerting automático em job failure via sistema existente
- Runbooks para: OpenRouter down, Drive failure, Odoo timeout, email ingestion stuck

---

## C. Plano de Governança de IA

### Fase 1: Rastreabilidade (1 semana)

```sql
CREATE TABLE ai_requests (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(50) NOT NULL, -- extract_invoice, extract_bl, anomaly, email_analysis, ncm_validation, correction_draft
  model VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(20),
  input_hash VARCHAR(64),         -- SHA-256 do input
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  cost_estimate NUMERIC(10,6),
  confidence NUMERIC(3,2),
  status VARCHAR(20) NOT NULL,    -- success, error, timeout, fallback
  error_message TEXT,
  process_id INTEGER REFERENCES import_processes(id),
  document_id INTEGER REFERENCES documents(id),
  triggered_by VARCHAR(50),       -- user, email_ingestion, validation, cron
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_requests_type ON ai_requests(request_type);
CREATE INDEX idx_ai_requests_created ON ai_requests(created_at);
```

### Fase 2: Resiliência (1 semana)

```typescript
// Fallback chain
const FALLBACK_CHAIN = {
  'extract': ['google/gemini-2.0-flash-001', 'anthropic/claude-sonnet-4', null],
  'anomaly': ['anthropic/claude-sonnet-4', 'google/gemini-2.0-flash-001', null],
  'email':   ['google/gemini-2.0-flash-001', null],
};

async function callWithFallback(type, prompt, input) {
  const chain = FALLBACK_CHAIN[type];
  for (const model of chain) {
    if (!model) return { result: null, needs_review: true };
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 60000);
      return await callOpenRouter(model, prompt, input, controller.signal);
    } catch (err) {
      logAiRequest({ type, model, status: 'error', error: err.message });
      continue;
    }
  }
}
```

### Fase 3: Human-in-the-loop (2 semanas)

```sql
ALTER TABLE documents ADD COLUMN needs_review BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE documents ADD COLUMN reviewed_at TIMESTAMPTZ;

CREATE TABLE ai_review_queue (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL, -- document, email, ncm, validation
  entity_id INTEGER NOT NULL,
  reason VARCHAR(100) NOT NULL,     -- low_confidence, ai_fallback, missing_fields
  confidence NUMERIC(3,2),
  assigned_to INTEGER REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, modified
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
```

### Fase 4: Avaliação Contínua (ongoing)

- Dataset de 50-100 docs anonimizados como golden examples
- Script de eval: `prompt × model × doc → accuracy por campo`
- KPIs: precision por campo, taxa de override, custo por documento
- Alerting se accuracy cai abaixo de threshold
- A/B test de prompts em shadow mode

---

## D. Plano de Melhoria de UX Operacional

### Fase 1: Fundação (1 semana)

```tsx
// Error boundary global
class AppErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return <ErrorFallback error={this.state.error} />;
    return this.props.children;
  }
}

// Toast system (sonner)
import { Toaster, toast } from 'sonner';
// Substituir alert() por toast.success() / toast.error()
```

### Fase 2: Componentes (2 semanas)

**Quebrar ProcessDetailPage em:**

```
features/processes/
├── ProcessDetailPage.tsx      (~200 linhas, orquestra tabs)
├── components/
│   ├── ProcessHeader.tsx      (código, marca, status, ações)
│   ├── ProcessInfoCard.tsx    (dados gerais, FOB, peso, etc)
│   ├── ProcessTimeline.tsx    (eventos consolidados)
│   ├── DocumentsTab.tsx       (upload, lista, preview)
│   ├── ComparisonTab.tsx      (INV × PL × BL)
│   ├── ValidationTab.tsx      (checklist + anomalias)
│   ├── EspelhoTab.tsx         (preview + envio)
│   ├── CambiosTab.tsx         (câmbios do processo)
│   └── FollowUpTab.tsx        (marcos + progresso)
```

### Fase 3: Cockpit Operacional (3-4 semanas)

**Nova página "Meu Dia":**

```
┌─────────────────────────────────────────────────┐
│  Bom dia, Nicolas          12/03/2026           │
├──────────┬──────────┬──────────┬────────────────│
│ 3 Ações  │ 2 LIs    │ 5 Diverg │ 1 Falha      │
│ Urgentes │ Vencendo │ Críticas │ Integração    │
├──────────┴──────────┴──────────┴────────────────│
│                                                  │
│ Processos que Exigem Ação Hoje                  │
│ ┌─ IMP-2026-045 │ Espelho pendente │ 3 dias     │
│ ├─ IMP-2026-051 │ LI vence amanhã  │ URGENTE    │
│ └─ IMP-2026-038 │ Divergência INV  │ 5 dias     │
│                                                  │
│ Emails Não Classificados (2)                    │
│ ┌─ supplier@example.com │ Invoice attached       │
│ └─ logistics@ship.com   │ BL copy                │
│                                                  │
│ Falhas de Integração Ativas                     │
│ ┌─ Google Sheets sync │ Timeout │ 2h atrás      │
│                                                  │
│ "Próxima Melhor Ação" por Processo              │
│ ┌─ IMP-2026-045 │ Gerar espelho → Enviar Fenicia│
│ ├─ IMP-2026-051 │ Submeter LI (deadline: amanhã)│
│ └─ IMP-2026-038 │ Revisar divergência peso bruto│
└─────────────────────────────────────────────────┘
```

### Fase 4: Inteligência (4+ semanas)

- Dashboard executivo vs operacional separados
- Tempo médio por etapa do processo
- Fornecedor com mais divergências
- Taxa de retrabalho por analista
- Sazonalidade de atrasos
- Assertividade da IA ao longo do tempo

---

# Apêndice: Inventário do Sistema

## Arquitetura

| App | Stack | Porta Dev | Porta Prod |
|-----|-------|-----------|------------|
| `apps/api` | Express + Drizzle + PostgreSQL | 3001 | 3050 |
| `apps/web` | React + Vite + Tailwind | 8080 | 8085 |
| `apps/cert-api` | Python FastAPI | 8002 | 8002 |

## Integrações Externas

| Serviço | Uso | Timeout atual |
|---------|-----|---------------|
| OpenRouter AI | Extração, anomalias, drafts | Nenhum |
| Google Drive | Upload documentos/espelhos | Default SDK |
| Google Sheets | Sync bidirecional Follow-Up | Default SDK |
| Google Groups | Controle de acesso | Default SDK |
| Gmail API / IMAP | Ingestão automática | Default SDK |
| Google Chat | Webhooks de alertas | Default SDK |
| Odoo XML-RPC | Validação de produtos | Nenhum |
| Nodemailer SMTP | Envio de emails | Default |

## Jobs Agendados

| Job | Horário | Status |
|-----|---------|--------|
| Deadline Check | 08:00 diário | Sem lock, sem alerting |
| Stalled Process | 09:00 diário | N+1, sem lock |
| Email Check | */5 min | Lock in-memory |
| Email Double-Check | 22:00 seg-sex | Lock compartilhado |
