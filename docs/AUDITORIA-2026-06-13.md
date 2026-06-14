<!-- Gerado por auditoria multi-agente (14 dimensões) em 2026-06-13. Registro das pendências de engenharia. -->

# Roadmap de Engenharia — Sistema `importacao` (Produção)

**Arquiteto-chefe · consolidação de 14 auditorias · 2026-06-13**

---

## 1. Diagnóstico executivo

O `importacao` é um sistema **maduro e acima da média para o porte**: backend Node em camadas consistentes (17/19 módulos seguem routes→controller→service→schema), schema Postgres bem modelado (FKs explícitas, NUMERIC monetário, historização append-only em transação), segurança sólida (OAuth Google fail-closed, SQL parametrizado nos dois backends, harness anti-alucinação de IA determinístico), e DevOps raro para o porte (backup verificado, restore-test semanal, multi-stage non-root). **A maior força é a disciplina de domínio**; a maior fraqueza é **divergência entre o que está documentado/testado e o que produção realmente roda**.

O risco isolado mais grave é o **cert-api**: o Dockerfile serve `main:app` (monólito stale de 3020 linhas, último commit 2026-05-22) enquanto toda a feature de certificados/Linx, hardening e os testes vivem em `app.main:app` (commit 2026-06-13) — confirmado no repositório. Qualquer rebuild limpo do compose sobe o código antigo, e a memória do projeto afirma que a feature está "em produção". Em segundo lugar vêm os **furos de operação invisíveis**: rollback do `deploy.sh` faz `git checkout` num servidor sem `.git` (rollback nunca funcionou), migrations 0011-0015 fora do `_journal.json` do Drizzle, `li_tracking` criada por duas apps com schemas incompatíveis, Sentry instrumentado mas sem `SENTRY_DSN` no container, e zero alerting (Prometheus sem rules/Alertmanager). Há também correção de dados real: parser de espelho quebra números em formato BR, e máquina de estados pode travar processos em `validating`.

---

## 2. Top 10 itens críticos / alto-impacto (deduplicados)

| #   | Título                                                                                                                                                                                                                                   | Dimensão              | Sev          | Esforço   | Risk            | Conf        | Arquivos                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------ | --------- | --------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| 1   | **Entrypoint do cert-api serve monólito stale** — Dockerfile roda `main:app` (sem feature certificados/Linx/hardening) em vez de `app.main:app`; rebuild limpo regride feature+segurança _(reportado por Arquitetura + cert-api + DB)_   | cert-api/deploy       | **critical** | small     | changes-prod    | high        | `apps/cert-api/Dockerfile:60`, `apps/cert-api/main.py`, `apps/cert-api/app/main.py`             |
| 2   | **Rollback do deploy é falso** — `git checkout` em servidor sem `.git` (rsync exclui), `\|\| true` mascara, e `up -d --build` reconstrói o código quebrado; mensagem "Rolled back" engana                                                | DevOps/deploy         | **critical** | medium    | changes-prod    | high        | `scripts/deploy.sh:130,187-189`                                                                 |
| 3   | **Migrations 0011-0015 fora do `_journal.json`** — `drizzle migrate` só vai até 0010; 0011-0015 só por script manual paralelo → deploy/DR limpo sobe schema incompleto, app quebra em runtime _(Arquitetura/DB/DevOps)_                  | DB/migration          | **high**     | medium    | needs-care      | high        | `apps/api/drizzle/meta/_journal.json`, `entrypoint.sh:8`, `scripts/apply-pending-migrations.sh` |
| 4   | **`li_tracking` definida por 2 apps com schemas incompatíveis** no mesmo banco via `CREATE TABLE IF NOT EXISTS`; vencedor depende da ordem de deploy; perda de FK/enum ou inserts quebrados; constraint UNIQUE criada lazy no erro       | DB/integridade        | **high**     | medium    | changes-prod    | high        | `apps/cert-api/app/db/postgres.py:224`, `apps/api/drizzle/0004…sql`, `erp_service.py:418`       |
| 5   | **Parser de espelho quebra números BR** — `replace(/,/g,'')` trata vírgula como milhar; `1.234,56`→NaN/valor errado; alimenta reconciliação e totais financeiros                                                                         | Backend/correção      | **high**     | small     | needs-care      | high        | `apps/api/src/modules/espelho-parser/parser.ts:243`, `documents/service.ts:1588`                |
| 6   | **Processo trava em `validating`** após falha de check; matriz não permite `validating→validating` → re-rodar dá 400; só sai manualmente                                                                                                 | Backend/state-machine | **high**     | small     | needs-care      | high        | `validation/service.ts:74-81`, `state-machine/process-states.ts:24`                             |
| 7   | **Sentry desligado + zero alerting** — `SENTRY_DSN` nunca chega ao container; Prometheus sem `rule_files`/Alertmanager; observabilidade só passiva, ninguém é avisado de incidente                                                       | Observabilidade       | **high**     | medium    | safe            | high        | `docker-compose.prod.yml` (env api), `infra/prometheus/prometheus.yml`, `sentry.ts:4`           |
| 8   | **`asyncHandler`/`errorHandler` ricos são código morto** — 102-104 controllers fazem `sendError(error.message, 400)` sem `next(error)`; `code`/`details` somem, 502/409 viram 400 _(Qualidade + API Design, mesma raiz)_                 | Backend/API           | **high**     | medium    | needs-care      | high        | `shared/utils/async-handler.ts`, `shared/middleware/error-handler.ts`, `*/controller.ts`        |
| 9   | **Listas no front mascaram erro como vazio + truncam dados** — Numerário/Desembaraço/LI/DocumentList não tratam `error` (mostram "Nenhum X"); telas financeiras puxam `limit=100/500` e filtram no cliente (KPIs incorretos ao crescer)  | Frontend/UX           | **high**     | small-med | safe→needs-care | high        | `numerario/NumerarioPage.tsx`, `desembaraco/…`, `li-tracking/…`, `communications/…`             |
| 10  | **Valor aduaneiro soma frete+seguro como USD e aplica taxa** — seguro Marin é BRL; inflaria base ×~5-6 e o numerário (×0,6) → impacto direto de caixa. **+ LI flaggada por NCM de 2 dígitos** (capítulo inteiro) gera falsos "requer LI" | Regras de negócio     | **high**     | medium    | changes-prod    | medium/high | `financial/calculations.ts:88-95`, `financial/service.ts:48-56`, `espelhos/service.ts:26-36`    |

---

## 3. Quick-wins SEGUROS (risk=safe, trivial/small) — implementar em lote

Nenhum altera comportamento de produção observável; corrigem ruído, higiene e bugs latentes.

**Higiene de repo / deps**

- Remover `"nodemailer": "^8.0.4"` de `package.json` raiz (linha 47) — dep stray, ninguém na raiz usa; já existe em `apps/api`. **(confirmado)**
- `git rm apps/cert-api/main.py.legacy` (118 KB, está no histórico) + remover dir fantasma `apps/cert-api/apps/`; adicionar `apps/cert-api/.venv/` ao `.gitignore` e `--exclude` no rsync do `deploy.sh`.
- Alinhar `@types/node` e `vitest` entre `apps/api` e `apps/web` (igualar faixas).

**Tooling / CI (gates)**

- `package.json` lint-staged: `eslint --max-warnings 0` (igualar ao CI, hoje permite 50).
- `apps/web/package.json`: `"test": "vitest run"` (+ `"test:watch": "vitest"`); CI chamar `test:coverage -w apps/web`. Hoje roda em watch e funciona por acidente.
- `ci.yml`: incluir `test-web`, `test-python`, `lint-python` no `needs:` do `build-docker`.
- `ci.yml`: rodar `npm run test:e2e -w apps/api` usando o Postgres já provisionado (os e2e existem e nunca rodam).

**Frontend (UX/A11y — todos safe)**

- Adicionar guard `if (error) return <ErrorState onRetry={refetch}/>` em `NumerarioPage`, `DesembaracoPage`, `LiTrackingPage`, `DocumentList`, `ValidationChecklist`, `ProcessDetailPage`, `ProcessEditPage` (componente já existe, padrão já usado em `ProcessListPage`).
- Trocar os 2 `window.confirm` (envio de e-mail ao fornecedor em `ValidationChecklist:347`; unlock em `ProcessHeader:73`) por `<ConfirmDialog variant="danger">` já existente.
- `toast.success` no `onSuccess` de `ProcessCreatePage`/`ProcessEditPage`.
- Debounce de 300ms na busca de `LiTrackingPage` (padrão de `ProcessListPage`).
- Persistir aba ativa em `?tab=` (`useSearchParams`) em `ProcessDetailPage`.
- Botão "Limpar filtros" em Numerário/Desembaraço/LI.
- CSS global `@media (prefers-reduced-motion: reduce)` em `app/index.css`.
- Adicionar `htmlFor`/`id` nos labels dos formulários (Process, Cert) e `focus-visible:ring-2` nos botões inline (a11y WCAG; mecânico).

**Backend (safe)**

- Dedupe de alerta de cron sem `processId` (`alerts/service.ts:hasDuplicateRecent` cobrir `processId IS NULL` por título) — hoje cada falha de cron gera alert storm (logistic-sync = 48/dia).
- `logistic-sync`: filtrar SELECT por status ativo + `lockedAt IS NULL` (ou tratar 423 como debug) — para de logar erro por processo travado a cada 30min.
- Mover `auditService.log` para fora da transação de `create` (best-effort, evita ref a entidade pós-rollback).
- `documents/reprocess`: envolver `archiveExtraction` + zeragem numa `db.transaction` (espelhar `runAllChecks`).
- `/metrics` IP allow-list: trocar `endsWith` por igualdade normalizada (`app.ts:62-74`).
- Schema Zod em `POST /auth/google` (`validate(googleLoginSchema)`), alinhando a `/auth/login`.

**Documentação (drift que trava onboarding — todos safe)**

- `ONBOARDING.md` passo 5: trocar `scripts/seed-admin.js` / `POST /auth/register` (não existem) por `npm run db:seed` (cria `admin@importacao.com`/`admin123`).
- `RUNBOOK.md` seção IA: trocar `GEMINI_API_KEY`/`AI Studio` (não existem) por `AI_PROVIDER` + `OPENROUTER_API_KEY`/`GOOGLE_VERTEX_*` + `AI_MONTHLY_BUDGET_USD`.
- `README.md`: SOPS+age (não "HashiCorp Vault"); corrigir contagem de testes e listar os 8 jobs de CI.
- `ONBOARDING.md`: cert-api em `:8002` (não 8000); Node 22 (não 20); "Vitest" (não jest).

---

## 4. Melhorias de médio esforço (alto valor, exigem cuidado/teste)

**Correção de dados (testar com fixtures antes)**

- Parser de espelho BR locale (#5): detectar separador decimal pelo último `,`/`.` antes de limpar.
- Travamento em `validating` (#6): permitir `validating→validating` na matriz **e** envolver checks em try/catch que reverte status.
- `deadline-check` timezone: reusar `toUtcDateOnly` do motor financeiro (off-by-one no prazo D+13 e câmbio).
- Pre-Cons: `excelDateToISO` parsear datas em texto BR/ISO (hoje descartadas silenciosamente).
- Demurrage só calcular com data de atracação real (não ETA prevista) — para falsos alertas críticos.

**Backend — qualidade/duplicação**

- Adotar `asyncHandler` + `next(error)` nos controllers (migração por módulo, com teste de contrato por rota) — resolve #8 e os fallbacks 400/404 ad-hoc de uma vez.
- Centralizar `withTimeout` (4 cópias sem `clearTimeout`) e `MS_PER_DAY`/`daysBetween` em `shared/utils`.
- Fábrica única de auth Google (`shared/google/auth.ts`) consumida por Sheets/Drive/Groups/Gmail/Vertex/auth.
- Eliminar `AuthenticatedRequest` cast em favor do augmentation global + helper `requireUser`.

**Segurança (defesa em profundidade)**

- Conectar `validateMagicBytes` (código morto) após multer nas 2 rotas de upload.
- Forçar `attachment`/`octet-stream` para HTML/SVG servido inline (mitigar stored XSS na origem do SPA).
- cert-api fail-closed: abortar startup se `CERT_API_KEY` vazio em produção (hoje fail-open libera escrita no ERP).
- Mascarar segredos nas respostas de `settings` admin (`********`/`isSet`).
- `npm audit fix` nas 5 vulns moderadas (cadeia gaxios/googleapis/node-cron via uuid).

**IA / pipeline de extração**

- **Expor o veredicto do harness na UI** (#1 da dimensão IA): `_trust.findings`/`reviewFields` ao revisor — hoje o maior valor do harness é descartado pelo filtro `_*`.
- `withRetry` com predicado `shouldRetry` (não re-tentar 400/403/404/429) — evita multiplicar custo/latência em incidente de provider (até 12 chamadas/doc).
- Estender harness a proforma/certificate/espelho (hoje sem verificação anti-alucinação; certificate alimenta o Linx).
- `validateNcm`/`detectAnomalies`/email-drafts: usar Zod+responseSchema (hoje `JSON.parse` cru).

**DB / integridade**

- `findDivergences` N+1 (2N+1 queries por sync Pre-Cons) → 2 queries com GROUP BY.
- Constraint/política para 1 documento por `(process_id, type)` ou selecionar o mais recente na validação.
- Migrations sob `pg_advisory_lock` no boot (preparar para >1 replica).

**cert-api (Python)**

- `CERTS_DIR` em volume nomeado no compose (hoje PDFs de certificado — evidência INMETRO/ANVISA — se perdem no restart).
- Remover credenciais/hosts hardcoded de `config.py` (incl. conta nominal `nicolas.matsuda`).
- Estado de validação in-memory + APScheduler em cada worker → fixar `--workers 1` documentado e/ou `pg_advisory_lock`; migrar `@app.on_event` para `lifespan`; SSE para `async`+`asyncio.sleep`.

**Frontend (médio)**

- Truncamento de Numerário/Desembaraço/Communications (#9): endpoint dedicado/paginado ou aviso "mostrando 100 de N".
- Gráficos Recharts theme-aware (tooltip branco-no-branco no dark) usando `useTheme`/tokens `--color-chart-*`.
- `<Modal>` compartilhado (focus trap/Escape/restauração) e `<Button>` (variants + `focus-visible` + `loading`) generalizando `SubmitButton`.

---

## 5. Itens que MUDAM comportamento de produção ou exigem decisão do Nicolas

> Cada um tem trade-off real. Não implementar em lote.

1. **Migrar cert-api para `app.main:app` e deletar `main.py` (#1).** Trade-off: precisa validar paridade de endpoints/comportamento entre monólito e pacote antes do switch; **mas é preciso confirmar primeiro no servidor o que de fato roda hoje** (`docker inspect`/`ps`) — se foi iniciado manualmente fora do Dockerfile, o risco é regredir no próximo rebuild. **Decisão pendente: validar produção real, depois trocar o CMD.**

2. **Valor aduaneiro: frete/seguro USD vs BRL (#10a).** Se as colunas estão em BRL, corrigir reduz numerário e valor aduaneiro de processos atuais — muda números que o time financeiro já viu. Exige confirmar a unidade real das colunas e comunicar. **Alto impacto de caixa nos dois sentidos.**

3. **Exigência de LI por NCM (#10b).** Mudar de prefixo-2-dígitos para tabela de NCM (4/8 dígitos) fará vários processos deixarem de ser "requer LI" — muda prazos D+13, escalonamento e alertas. Correto, mas precisa da fonte oficial de NCMs que exigem anuência.

4. **Numerário 0,6 fixo sem reconciliação pós-Rascunho da DI.** Decisão de produto: modelar estimado vs confirmado.

5. **`DELETE /processes/:id` liberado a qualquer analista** — adicionar `adminMiddleware` (alinha a lock/unlock). Trade-off mínimo, mas pode quebrar fluxo de quem hoje deleta.

6. **Validação 400→422 / RFC 7807** — qualquer consumidor que cheque status quebra.

7. **`POST /api/certificates` 200→201 + idempotência por (sku, brand)** — evita certificado duplicado e dupla escrita no Linx; muda contrato.

8. **Alerta de câmbio/seguro vencido (`daysRemaining<0`)** — passa a gerar alertas críticos que hoje não existem (desejável, mas é novo ruído).

9. **Role do JWT vs banco** — usar role do banco no middleware faz rebaixamento admin→analyst valer na hora (hoje até 24h).

10. **Deploy "zero-downtime" é falso** — decidir entre blue-green real (large) ou renomear honestamente + agendar janela.

---

## 6. Iniciativas maiores (refactors / projetos)

- **Contrato de tipos compartilhado api↔web** — OpenAPI já é gerado dos Zod schemas mas ninguém consome; o front redigita o domínio à mão. Introduzir `openapi-typescript` ou `packages/contracts`. Transforma drift de contrato em erro de compilação. _(large)_
- **OpenAPI do Node API** (só cert-api tem) via `zod-to-openapi` → habilita teste de contrato no CI. _(medium)_
- **Cobertura de testes do front** — 4/19 features testadas, zero nas telas financeiras; sem thresholds de cobertura no CI; middleware de segurança (auth/rate-limit/error-handler) sem nenhum teste. Priorizar formulários financeiros + middleware. _(large)_
- **Design system: `<Button>`/`<Modal>` + a11y sistêmica** (labels, focus-visible, contraste slate-400→500, gráficos theme-aware). _(medium-large)_
- **Observabilidade ativa** — `SENTRY_DSN`+`APP_VERSION` no container, regras Prometheus (api down, p95, fila travada, 5xx, disco) + Alertmanager/Grafana Alerting → Google Chat (webhook já existe). _(medium)_
- **Pipeline de deploy profissional** — build em CI + registry com tag=SHA, `pull` no servidor, rollback por imagem, gate de "CI verde para o SHA", modo não-interativo. Resolve #2, builds em prod e bus-factor. _(large)_
- **Governança de schema do banco compartilhado** — eleger dono único de `li_tracking` (Drizzle), proibir cert-api de fazer DDL em tabelas do Drizzle, reconciliar journal, unificar mecanismo de migration. _(medium-large)_
- **Orquestrador de monorepo** (Makefile/turbo) cobrindo os 3 apps incl. cert-api first-class. _(medium)_
- **Quebrar god-services**: `documents/service.ts` (1802 linhas) e `email-ingestion/processor.ts` (1278) em colaboradores coesos + classifiers testáveis. _(large)_
- **Consolidar agendamento** (node-cron → pg-boss schedules duráveis). _(medium)_
- **Diagramas de arquitetura Mermaid** versionados (componentes+integrações, sequência de auth/validação). _(medium)_

---

## 7. Forças do sistema (preservar)

- **Camadas consistentes no `apps/api`**: 17-18/19-21 módulos seguem routes→controller→service→schema; módulos desacoplados via event-emitter (zero import cruzado); `shared/` bem fatiado.
- **Hierarquia de erros tipada + `errorHandler` global robusto** (ZodError com details, 413/415/Multer/EACCES/ENOSPC, Sentry) — infra certa, só falta os controllers usarem.
- **Schema Postgres maduro**: FKs com ON DELETE explícito, NUMERIC monetário com precisão, enums tipados, **historização append-only em transação** (validation/extraction history), índices compostos alinhados às queries.
- **Motor financeiro como funções puras testáveis** com timezone UTC correto e fallback que se recusa a persistir BRL sem taxa.
- **Segurança madura**: OAuth Google fail-closed (grupo + domínio), `authMiddleware` em todos os routers, SQL parametrizado nos dois backends, `_ident` hard-valida identificadores do Linx, upload com magic bytes no cert-api, helmet/HSTS/ports em 127.0.0.1.
- **Harness de IA anti-alucinação determinístico** (grounding, ISO 6346 check-digit, CNPJ DV, GTIN mod-10, soma de itens, peso) — ponto alto; abstração de provider limpa; budget cap mensal com alerta 80%; fallback flash→pro com guarda de delta.
- **Testes unitários de verdade** (mocks reais, asserts de comportamento) cobrindo financeiro, state-machine, validation checks, gating Linx, upgrade de extração.
- **DevOps acima da média**: Dockerfiles multi-stage non-root, healthchecks, limites de recurso, `backup-db.sh` com verificação de integridade, **restore-test semanal automatizado**, métricas Prometheus com normalização de cardinalidade, DR.md/RUNBOOK.md existentes.
- **Documentação ampla** (5 ADRs, RUNBOOK, DR, SECRETS, CHANGELOG Keep-a-Changelog amarrado a PRs/SHAs) — a base existe, só precisa de correção de drift.

---

**Ordem de ataque recomendada (impacto×confiança/esforço):** lote de quick-wins da seção 3 → #5 e #6 (correção de dados, small) → #7 (observabilidade) → confirmar produção do cert-api e executar #1 → #2/#3/#4 (operação/DB) → decisões da seção 5 com o Nicolas (#10 financeiro/LI primeiro) → iniciativas maiores.
