# Importacao - Sistema de Gestao de Importacoes

Sistema completo de gestao de processos de importacao para o Grupo Uni.co, com modulo de validacao automatizada de certificacoes e-commerce (INMETRO, ANATEL, ANVISA) para as marcas **Puket** e **Imaginarium**.

## Arquitetura

Monorepo com 3 servicos orquestrados via Docker Compose:

```
importacao/
├── apps/
│   ├── api/          # Node.js Express API (TypeScript)
│   ├── web/          # React SPA (TypeScript + Vite + Tailwind)
│   └── cert-api/     # Python FastAPI - Validacao de Certificacoes
├── .github/workflows/ # CI pipeline (lint, typecheck, test, build)
├── scripts/           # Deploy e utilitarios
├── docker-compose.yml        # Desenvolvimento
├── docker-compose.prod.yml   # Producao
└── .env.example              # Variaveis de ambiente
```

### Stack Tecnologica

| Servico      | Tecnologia                        | Porta Dev | Porta Prod |
| ------------ | --------------------------------- | --------- | ---------- |
| **Web**      | React 18, Vite 6, Tailwind CSS 4  | 8080      | 8085       |
| **API**      | Node.js, Express, Drizzle ORM     | 3001      | 3050       |
| **Cert API** | Python 3.12, FastAPI, APScheduler | 8000      | (interno)  |
| **Banco**    | PostgreSQL 16 Alpine              | 5432      | 5450       |
| **Redis**    | Redis 7 Alpine                    | 6379      | 6379       |

### Diagrama de Comunicacao

```
Browser ──> Nginx (Web)
              ├── /api/* ──────────> Node API ──> PostgreSQL
              │                        ├──> Redis (cache + filas)
              │                        ├──> pg-boss (job queue)
              │                        └──> IA_LOCAL / DocIntel
              ├── /cert-api/* ─────> Cert API ──> PostgreSQL
              │                         ├──> Google Sheets
              │                         └──> VTEX API (tempo real)
              └── /* ──────────────> React SPA
```

## Inicio Rapido

### Pre-requisitos

- Docker e Docker Compose
- Node.js 22+ (para desenvolvimento local)
- Python 3.12+ (para desenvolvimento local do cert-api)

### 1. Clonar e Configurar

```bash
git clone https://github.com/nmatss/importacao.git
cd importacao
cp .env.example .env
# Editar .env com suas credenciais
```

### 2. Desenvolvimento Local

```bash
# Subir todos os servicos
docker compose up -d

# Ou individualmente
npm run dev:api   # API Node.js na porta 3001
npm run dev:web   # Frontend React na porta 5173
```

### 3. Producao

```bash
# Deploy automatizado
bash scripts/deploy.sh

# Ou manual
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Acesso local do container web: `http://localhost:8085`. Em producao publica,
acesse sempre via HTTPS pelo reverse proxy/TLS externo.

## Modulos do Sistema

### Gestao de Importacoes (API + Web)

| Modulo                    | Descricao                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Dashboard Operacional** | Visao geral de processos, metricas, SLA e alertas                                                               |
| **Dashboard Executivo**   | KPIs estrategicos, graficos por marca, timeline de volume                                                       |
| **Meu Dia**               | Cockpit pessoal com tarefas pendentes, alertas e LIs urgentes                                                   |
| **Processos**             | CRUD completo com workflow de status (state machine)                                                            |
| **Documentos**            | Upload com validacao magic-byte, gestao e comparacao side-by-side                                               |
| **Validacao**             | 27+ checks automatizados, gate de completude documental, modo parcial diagnostico e historico por run           |
| **Espelhos**              | Geracao de espelhos com templates por marca (join por EAN com fallback itemCode)                                |
| **Financeiro**            | Valor aduaneiro, numerario (x0,6) e %numerario; alertas de invoice baixa, seguro e demurrage (job diario 08:30) |
| **Compras e Pagamentos**  | Relatorio SYDLE admin-only de compras/pagamentos internacionais com sync incremental a cada 15 minutos          |
| **LI Tracking**           | Rastreamento de Licencas de Importacao                                                                          |
| **Desembaraco**           | Acompanhamento de desembaraco aduaneiro                                                                         |
| **Numerario**             | Controle de numerario                                                                                           |
| **Cambio**                | Controle de taxas de cambio e prazos                                                                            |
| **Comunicacoes**          | Emails via SMTP/Gmail API com drafts e auto-correcao                                                            |
| **Follow-up**             | Rastreamento com sync bidirecional Google Sheets                                                                |
| **Alertas**               | Sistema de alertas (info, warning, critical)                                                                    |
| **Email Ingestion**       | Importacao automatica via IMAP com classificacao AI                                                             |
| **Auditoria**             | Log completo de acoes dos usuarios                                                                              |
| **Configuracoes**         | Parametros gerais, SMTP, integracoes                                                                            |

### Validacao de Certificacoes (Cert API + Web)

| Pagina                    | Descricao                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Dashboard**             | Estatisticas gerais, grafico por marca, produtos com problemas                                                 |
| **Validacao**             | Execucao de validacao em tempo real com progresso via SSE                                                      |
| **Produtos**              | Listagem completa com filtros, busca e verificacao individual                                                  |
| **Relatorios**            | Historico de relatorios gerados com download XLSX/JSON e estoque detalhado WMS + e-commerce                    |
| **Agendamentos**          | Configuracao de cron jobs com APScheduler                                                                      |
| **Cadastrar Certificado** | Formulario de cadastro (datas, OCP, PDF) + escrita gated no Linx PROP_PRODUTOS — ver `docs/CERT-LINX-WRITE.md` |
| **Configuracoes**         | Status do sistema, teste de conexao, informacoes                                                               |

#### Marcas e Lojas Monitoradas

| Marca           | Loja VTEX               | Campo de Certificacao |
| --------------- | ----------------------- | --------------------- |
| Puket           | puket.com.br            | `complementName`      |
| Puket Escolares | puket.com.br            | `complementName`      |
| Imaginarium     | loja.imaginarium.com.br | `description`         |

## Infraestrutura Tecnica

### Seguranca

- **Helmet.js** — headers de seguranca HTTP
- **Rate limiting** — protecao contra abuso em rotas de autenticacao
- **HTML sanitization** — sanitizacao reforçada no backend (script, style, svg, iframe, object, embed, form, data/vbscript URLs)
- **Magic-byte validation** — verificacao real do tipo de arquivo em uploads
- **API Key auth** — autenticacao fail-closed por chave no cert-api; `/api/health` e `/api/ready` ficam sem chave para healthcheck
- **Non-root containers** — USER node/appuser nos Dockerfiles
- **Correlation ID** — rastreamento de requests end-to-end

### State Machine

Transicoes de status de processo sao validadas por uma state machine com guards:

- `canTransition(from, to)` — verifica se a transicao e permitida
- `assertTransition(from, to)` — lanca `InvalidTransitionError` se invalida
- Guards previnem estados inconsistentes (ex: nao pode pular etapas)

### Job Queue (pg-boss)

Processamento assincrono via PostgreSQL-backed job queue:

- `email-send` — envio de emails via fila
- `drive-sync` — sincronizacao com Google Drive
- `sheets-sync` — sync bidirecional com Google Sheets
- `ai-extraction` — extracao documental com IA

### Event System

Event emitter tipado com 6 tipos de eventos:

- `process.created`, `process.status_changed`
- `document.uploaded`, `validation.completed`
- `email.received`, `alert.created`

### Cache (Redis)

- **RedisCache** com fallback automatico para **MemoryCache**
- Suporte a TTL, invalidacao por pattern
- Conexao resiliente com retry strategy

### AI Governance

- Logging de todas as requisicoes AI (latencia, modelo, status) com flag `aiGovernance` no Pino
- Provider padrao em producao: `AI_PROVIDER=ialocal` com `AI_ALLOW_EXTERNAL=false`
- Providers externos (`vertex`, `openrouter`) exigem opt-in explicito via `AI_ALLOW_EXTERNAL=true`
- Schemas Zod validam respostas AI; falha de schema no caminho permissivo rebaixa confianca/gera revisao operacional
- Regex-first em email ingestion (skip AI quando regex resolve)
- Prompt versioning para rastreabilidade

### Observabilidade

- **Prometheus metrics** — endpoint `/metrics` com metricas HTTP, Node.js e queue; em producao fica atras de rede Docker/local e deve permanecer sem exposicao publica direta
- **Swagger/OpenAPI** — documentacao interativa em `/api/docs` com spec JSON em `/api/docs/openapi.json`; em producao fica desabilitada por default e exige `API_DOCS_ENABLED=true`
- **Queue monitoring** — endpoint admin `/api/admin/queue-stats` com status de todas as filas pg-boss
- **Cron job alerts** — falhas em cron jobs geram alertas criticos automaticos no sistema

### Custom Error Classes

Hierarquia de erros tipados com dispatch automatico no error handler:

- `AppError` (base) → `NotFoundError`, `ValidationError`, `ConflictError`, `IntegrationError`, `InvalidTransitionError`

## Integracoes

| Servico           | Uso                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Google OAuth**  | Autenticacao de usuarios (restrito por dominio/grupo)                                                                    |
| **Google Drive**  | Armazenamento de documentos                                                                                              |
| **Google Sheets** | Fonte de dados de certificacoes + follow-up sync                                                                         |
| **Gmail API**     | Ingestao automatica de emails                                                                                            |
| **VTEX API**      | Verificacao de certificacoes em tempo real                                                                               |
| **Odoo**          | Integracao ERP via XML-RPC (com timeout 30s)                                                                             |
| **SYDLE**         | Relatorio admin-only de compras/pagamentos internacionais; sync real depende de contrato/payload e `SYDLE_*` configurado |
| **IA_LOCAL**      | Analise de documentos com DocIntel on-prem, sem egress por padrao                                                        |
| **Redis**         | Cache e rate limiting                                                                                                    |

## Variaveis de Ambiente

Copie `.env.example` para `.env` e configure:

| Categoria       | Variaveis                                                                     |
| --------------- | ----------------------------------------------------------------------------- |
| **Banco**       | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`           |
| **Auth**        | `JWT_SECRET`, `JWT_EXPIRES_IN`, `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN`          |
| **Google**      | `GOOGLE_DRIVE_CLIENT_EMAIL`, `GOOGLE_DRIVE_PRIVATE_KEY`, `GOOGLE_ADMIN_EMAIL` |
| **Email**       | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`                            |
| **VTEX/Sheets** | `GOOGLE_SHEETS_SPREADSHEET_ID`                                                |
| **IA**          | `AI_PROVIDER`, `AI_ALLOW_EXTERNAL`, `IA_LOCAL_BASE_URL`, `IA_LOCAL_API_KEY`   |
| **Odoo**        | `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_PASSWORD`                           |
| **Redis**       | `REDIS_URL`                                                                   |

Em producao, secrets sao gerenciados via **SOPS + age** (arquivo `.env.sops.yaml`, regras em `.sops.yaml`); ver `docs/SECRETS.md`. HashiCorp Vault permanece como metodo legado.

## Banco de Dados

PostgreSQL 16 com schema gerenciado pelo Drizzle ORM (API Node) e tabelas adicionais criadas pelo Cert API.

### Tabelas Principais

**API Node (Drizzle):**
`users`, `import_processes`, `documents`, `process_items`, `validation_results`, `validation_runs`, `currency_exchanges`, `follow_up_tracking`, `espelhos`, `li_tracking`, `communications`, `alerts`, `audit_logs`, `system_settings`, `email_ingestion_logs`, `job_runs`

**Cert API (Python):**
`cert_products`, `cert_validation_runs`, `cert_validation_results`, `cert_schedules`, `cert_schedule_history`

### Indices

- Compostos: `(status, brand)`, `(status, updated_at)`, `(process_id, status, resolved_manually)`, `(process_id, type)`
- Trigram GIN: `process_code` para buscas ILIKE performaticas
- Unique: `(process_id, version, is_partial)` em espelhos
- FKs com `ON DELETE CASCADE/SET NULL` onde explicitamente definido no schema

### Migracoes

```bash
npm run db:generate  # Gerar migracoes
npm run db:migrate   # Aplicar migracoes
npm run db:seed      # Seed inicial
```

## Testes

```bash
# Unitários API + Web
npm test

# E2E da API (PostgreSQL e GreenMail descartáveis; requer Docker)
npm run test:e2e -w apps/api

# E2E do Web em Chromium desktop/mobile (Vite iniciado pelo harness)
npm run test:e2e:web

# Com watch mode
npm run test:watch -w apps/api

# Com coverage
npm run test:coverage -w apps/api
```

Baseline validado em 2026-08-26: **API 977 testes unitários + 48 E2E**,
**Web 131 unitários + 4 Playwright** e **Cert API 509 pytest**.

- **Unitarios**: state machine, validation checks, AI service, date utils
- **Integracao**: process, validation, document, espelho, dashboard services
- **Snapshot**: templates Excel (Puket/Imaginarium), templates email (3 tipos)
- **Cert API (pytest)**: health, rotas de certificados, cert service, linx service, stock, rotas gerais
- **E-mail E2E**: SMTP/IMAPS, PDF, flags, lease de ingestão, sanitização e envio pela API sem egress externo

## CI/CD

GitHub Actions pipeline (`.github/workflows/ci.yml`), Node 22:

1. **lint-api** — typecheck (`tsc --noEmit`) + ESLint da API
2. **lint-web** — typecheck (`tsc --noEmit`) + ESLint do Web
3. **lint-python** — `ruff check apps/cert-api/`
4. **test-api** — Vitest (unit) com PostgreSQL 16 service container (gera coverage)
5. **test-web** — Vitest do Web
6. **test-python** — pytest do cert-api
7. **security-scan** — `npm audit --audit-level=high` (bloqueante)
8. **build-docker** — build das imagens API/Web/Cert API + scan Trivy (CRITICAL/HIGH) e SBOM (syft); roda apos todos os lints/testes/audit passarem

## Deploy em Producao

### Deploy Automatizado

```bash
bash scripts/deploy.sh [server-ip]
```

O script:

1. Exige `master` limpo e sincronizado com `origin/master`.
2. Executa backup PostgreSQL e cria snapshot remoto de rollback do codigo.
3. Sincroniza codigo via rsync, excluindo caches/worktrees locais e preservando dados remotos.
4. Gera `.env` via SOPS + age a partir de `.env.sops.yaml`; se falhar, aborta.
5. Renderiza Alertmanager quando configurado e valida `docker compose config`.
6. Aplica migrations pendentes, builda/reinicia `api`, `web` e `cert-api`.
7. Verifica API `/health/ready`, web local/publica opcional e cert-api `/api/ready`.
8. Atualiza observabilidade, grava `REVISION` e remove snapshot se tudo passar.

### Portas Producao

| Servico     | Porta Externa  | Porta Interna |
| ----------- | -------------- | ------------- |
| Web (Nginx) | 127.0.0.1:8085 | 80            |
| API Node    | 127.0.0.1:3050 | 3001          |
| Cert API    | --             | 8000          |
| PostgreSQL  | 127.0.0.1:5450 | 5432          |
| Redis       | --             | 6379          |

### Volumes Persistentes

- `pgdata` — Dados do PostgreSQL
- `redisdata` — Dados do Redis
- `uploads` — Documentos uploaded
- `cert-reports` — Relatorios XLSX/JSON de certificacao
- `cert-certs` — PDFs/evidencias de certificados cadastrados

## Desenvolvimento

### Estrutura do Frontend

```
apps/web/src/
├── features/           # Modulos por funcionalidade
│   ├── auth/           # Login, autenticacao
│   ├── portal/         # Portal de selecao de modulos
│   ├── certificacoes/  # Modulo de certificacoes completo
│   ├── dashboard/      # Dashboard operacional, executivo, Meu Dia
│   ├── processes/      # Gestao de processos
│   │   └── components/ # ProcessHeader, ProcessInfoCard, Tabs, Timeline...
│   └── ...
├── shared/
│   ├── components/     # ErrorBoundary, ImportacaoLayout, CertificacoesLayout
│   ├── hooks/          # React hooks customizados
│   ├── lib/            # API client, cert-api-client (tipados)
│   └── types/          # Interfaces compartilhadas (15+ tipos)
└── main.tsx            # Entry point
```

### Estrutura do Backend

```
apps/api/src/
├── modules/            # Modulos de dominio
│   ├── auth/           # Autenticacao JWT + Google OAuth
│   ├── processes/      # CRUD de processos
│   ├── documents/      # Upload e gestao de documentos
│   ├── ai/             # OpenRouter + governance + schemas
│   ├── dashboard/      # Operacional + executivo
│   ├── validation/     # 27 checks + engine
│   │   └── checks/     # Checks individuais em arquivos separados
│   └── ...
├── shared/
│   ├── cache/          # Redis + MemoryCache fallback
│   ├── database/       # Schema Drizzle, conexao, migracoes
│   ├── errors/         # Custom error classes
│   ├── events/         # Event emitter tipado
│   ├── metrics/        # Prometheus (prom-client) middleware + registry
│   ├── middleware/     # Auth, CORS, upload, correlation-id, error-handler
│   ├── queue/          # pg-boss workers
│   ├── state-machine/  # Process status transitions
│   └── utils/          # Logger, helpers
├── app.ts              # Configuracao Express (helmet, CORS, middleware)
├── routes.ts           # Rotas centralizadas
└── server.ts           # Entry point
```

### Scripts

```bash
npm run dev:api       # Dev API com hot-reload
npm run dev:web       # Dev frontend com Vite HMR
npm run build:api     # Build API
npm run build:web     # Build frontend
npm test -w apps/api  # Testes unitarios + integracao
npm run docker:up     # Docker Compose up
npm run docker:down   # Docker Compose down
npm run docker:build  # Docker Compose build
bash scripts/backup-db.sh  # Backup PostgreSQL (retenção 7 dias)
# Após build/deploy: prova integrações sem ler conteúdo nem enviar mensagem
docker exec importacao-api node /app/scripts/smoke-integrations.mjs --network
```

O smoke de integrações imprime somente estados sanitizados. Ele autentica
Gmail/IMAP, verifica o transporte SMTP e faz leitura de metadados da raiz do
Drive. O Google Chat tem apenas formato validado: nenhuma mensagem é publicada.

### Endpoints de Operacao

| Endpoint                     | Acesso     | Descricao                                             |
| ---------------------------- | ---------- | ----------------------------------------------------- |
| `GET /health`                | Publico    | Healthcheck da API                                    |
| `GET /metrics`               | Restrito   | Metricas Prometheus via rede local/Docker             |
| `GET /api/docs`              | Dev/opt-in | Swagger UI; em producao exige `API_DOCS_ENABLED=true` |
| `GET /api/docs/openapi.json` | Dev/opt-in | Spec OpenAPI 3.0 JSON                                 |
| `GET /api/admin/queue-stats` | Admin      | Status das filas pg-boss                              |

### Backup do Banco

```bash
# Backup manual
bash scripts/backup-db.sh

# Crontab recomendado (2h da manhã, diário)
0 2 * * * /home/nicolas/importacao/scripts/backup-db.sh >> /var/log/importacao-backup.log 2>&1
```

Backups salvos em `/backups/importacao/` com retenção de 7 dias.

## Documentacao

Por onde começar, em ordem sugerida para quem chega agora:

1. [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — setup de desenvolvimento
2. [`docs/_extracted/manual-sistema-grupounico.md`](docs/_extracted/manual-sistema-grupounico.md) — manual funcional do sistema
3. [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operação e troubleshooting · [`docs/DR.md`](docs/DR.md) — disaster recovery
4. [`docs/adr/`](docs/adr/) — decisões de arquitetura (monorepo, Drizzle, JWT, cert-api, design system)

Estado e backlog da entrega:

- [`docs/STATUS-2026-08-03-REPROCESSAMENTO-DOCUMENTAL.md`](docs/STATUS-2026-08-03-REPROCESSAMENTO-DOCUMENTAL.md) — inventario de producao, escopo canonico, riscos e plano para reprocessar a base sem o DEMO
- [`docs/ENTREGA-2026-06-11.md`](docs/ENTREGA-2026-06-11.md) — registro consolidado da entrega em produção (UAT + harness + cert-Linx + hardening + Parte A + deploy)
- [`docs/ODETT-STATUS.md`](docs/ODETT-STATUS.md) — status da UAT da Odett + camada de confiança da IA
- [`docs/REVISAO-100.md`](docs/REVISAO-100.md) — gap analysis e backlog vivo da "Parte A 100%"
- [`docs/AI-HARNESS.md`](docs/AI-HARNESS.md) — harness de confiança da IA (Vertex, skills, knowledge base)
- [`docs/CERT-LINX-WRITE.md`](docs/CERT-LINX-WRITE.md) — cadastro de certificado + escrita no Linx (gated por `LINX_WRITE_ENABLED`)
- [`docs/SECRETS.md`](docs/SECRETS.md) · [`docs/TLS.md`](docs/TLS.md) — segredos e TLS
- [`docs/diagnostico-tecnico-completo.md`](docs/diagnostico-tecnico-completo.md) — diagnóstico histórico (2026-03), mantido para referência

## Licenca

Projeto privado - Grupo Uni.co. Todos os direitos reservados.
