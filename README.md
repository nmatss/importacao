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

| Servico | Tecnologia | Porta Dev | Porta Prod |
|---------|-----------|-----------|------------|
| **Web** | React 18, Vite 6, Tailwind CSS 4 | 8080 | 8085 |
| **API** | Node.js, Express, Drizzle ORM | 3001 | 3050 |
| **Cert API** | Python 3.12, FastAPI, APScheduler | 8000 | (interno) |
| **Banco** | PostgreSQL 16 Alpine | 5432 | 5450 |
| **Redis** | Redis 7 Alpine | 6379 | 6379 |

### Diagrama de Comunicacao

```
Browser ──> Nginx (Web)
              ├── /api/* ──────────> Node API ──> PostgreSQL
              │                        ├──> Redis (cache + filas)
              │                        ├──> pg-boss (job queue)
              │                        └──> OpenRouter AI
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

Acesse: `http://localhost:8085`

## Modulos do Sistema

### Gestao de Importacoes (API + Web)

| Modulo | Descricao |
|--------|-----------|
| **Dashboard Operacional** | Visao geral de processos, metricas, SLA e alertas |
| **Dashboard Executivo** | KPIs estrategicos, graficos por marca, timeline de volume |
| **Meu Dia** | Cockpit pessoal com tarefas pendentes, alertas e LIs urgentes |
| **Processos** | CRUD completo com workflow de status (state machine) |
| **Documentos** | Upload com validacao magic-byte, gestao e comparacao side-by-side |
| **Validacao** | 26 checks automatizados com IA (OpenRouter) e governance |
| **Espelhos** | Geracao de espelhos com templates por marca |
| **LI Tracking** | Rastreamento de Licencas de Importacao |
| **Desembaraco** | Acompanhamento de desembaraco aduaneiro |
| **Numerario** | Controle de numerario |
| **Cambio** | Controle de taxas de cambio e prazos |
| **Comunicacoes** | Emails via SMTP/Gmail API com drafts e auto-correcao |
| **Follow-up** | Rastreamento com sync bidirecional Google Sheets |
| **Alertas** | Sistema de alertas (info, warning, critical) |
| **Email Ingestion** | Importacao automatica via IMAP com classificacao AI |
| **Auditoria** | Log completo de acoes dos usuarios |
| **Configuracoes** | Parametros gerais, SMTP, integracoes |

### Validacao de Certificacoes (Cert API + Web)

| Pagina | Descricao |
|--------|-----------|
| **Dashboard** | Estatisticas gerais, grafico por marca, produtos com problemas |
| **Validacao** | Execucao de validacao em tempo real com progresso via SSE |
| **Produtos** | Listagem completa com filtros, busca e verificacao individual |
| **Relatorios** | Historico de relatorios gerados com download CSV |
| **Agendamentos** | Configuracao de cron jobs com APScheduler |
| **Configuracoes** | Status do sistema, teste de conexao, informacoes |

#### Marcas e Lojas Monitoradas

| Marca | Loja VTEX | Campo de Certificacao |
|-------|-----------|----------------------|
| Puket | puket.com.br | `complementName` |
| Puket Escolares | puket.com.br | `complementName` |
| Imaginarium | loja.imaginarium.com.br | `description` |

## Infraestrutura Tecnica

### Seguranca

- **Helmet.js** — headers de seguranca HTTP
- **Rate limiting** — protecao contra abuso em rotas de autenticacao
- **DOMPurify** — sanitizacao de HTML no frontend
- **Magic-byte validation** — verificacao real do tipo de arquivo em uploads
- **API Key auth** — autenticacao por chave no cert-api
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

- Logging de todas as requisicoes AI (latencia, modelo, status)
- Schemas Zod para validacao de respostas AI
- Fallback chain entre modelos (gemini-flash <-> claude-sonnet)
- Regex-first em email ingestion (skip AI quando regex resolve)
- Prompt versioning para rastreabilidade

### Custom Error Classes

Hierarquia de erros tipados com dispatch automatico no error handler:
- `AppError` (base) → `NotFoundError`, `ValidationError`, `ConflictError`, `IntegrationError`, `InvalidTransitionError`

## Integracoes

| Servico | Uso |
|---------|-----|
| **Google OAuth** | Autenticacao de usuarios (restrito por dominio/grupo) |
| **Google Drive** | Armazenamento de documentos |
| **Google Sheets** | Fonte de dados de certificacoes + follow-up sync |
| **Gmail API** | Ingestao automatica de emails |
| **VTEX API** | Verificacao de certificacoes em tempo real |
| **Odoo** | Integracao ERP via XML-RPC (com timeout 30s) |
| **OpenRouter** | Analise de documentos com IA (Gemini Flash + Claude Sonnet) |
| **Redis** | Cache e rate limiting |

## Variaveis de Ambiente

Copie `.env.example` para `.env` e configure:

| Categoria | Variaveis |
|-----------|-----------|
| **Banco** | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| **Auth** | `JWT_SECRET`, `JWT_EXPIRES_IN`, `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN` |
| **Google** | `GOOGLE_DRIVE_CLIENT_EMAIL`, `GOOGLE_DRIVE_PRIVATE_KEY`, `GOOGLE_ADMIN_EMAIL` |
| **Email** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| **VTEX/Sheets** | `GOOGLE_SHEETS_SPREADSHEET_ID` |
| **IA** | `OPENROUTER_API_KEY` |
| **Odoo** | `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_PASSWORD` |
| **Redis** | `REDIS_URL` |

Em producao, secrets sao gerenciados via **HashiCorp Vault** (`secret/importacao`).

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
- ON DELETE CASCADE/SET NULL em todas as FKs

### Migracoes

```bash
npm run db:generate  # Gerar migracoes
npm run db:migrate   # Aplicar migracoes
npm run db:seed      # Seed inicial
```

## Testes

```bash
# Rodar todos os testes
npm test -w apps/api

# Com watch mode
npm run test:watch -w apps/api

# Com coverage
npm run test:coverage -w apps/api
```

**119 testes** em 17 arquivos:
- **Unitarios**: state machine, validation checks, AI service, date utils
- **Integracao**: process, validation, document, espelho, dashboard services
- **Snapshot**: templates Excel (Puket/Imaginarium), templates email (3 tipos)

## CI/CD

GitHub Actions pipeline (`.github/workflows/ci.yml`):
1. **lint-and-typecheck** — `tsc --noEmit` para API e Web
2. **test** — Vitest com PostgreSQL 16 service container
3. **build** — Build de producao de API e Web (apos testes passarem)

## Deploy em Producao

### Deploy Automatizado

```bash
bash scripts/deploy.sh [server-ip]
```

O script:
1. Verifica compilacao TypeScript (API + Web)
2. Sincroniza codigo via rsync
3. Gera `.env` a partir do HashiCorp Vault
4. Build Docker images (no-cache)
5. Deploy com force-recreate
6. Verifica saude dos containers

### Portas Producao

| Servico | Porta Externa | Porta Interna |
|---------|--------------|---------------|
| Web (Nginx) | 8085 | 80 |
| API Node | 3050 | 3001 |
| Cert API | -- | 8000 |
| PostgreSQL | 5450 | 5432 |
| Redis | 6379 | 6379 |

### Volumes Persistentes

- `pgdata` — Dados do PostgreSQL
- `redisdata` — Dados do Redis
- `uploads` — Documentos uploaded
- `cert-reports` — Relatorios CSV de certificacao

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
│   ├── validation/     # 26 checks + engine
│   │   └── checks/     # Checks individuais em arquivos separados
│   └── ...
├── shared/
│   ├── cache/          # Redis + MemoryCache fallback
│   ├── database/       # Schema Drizzle, conexao, migracoes
│   ├── errors/         # Custom error classes
│   ├── events/         # Event emitter tipado
│   ├── middleware/     # Auth, CORS, upload, correlation-id, error-handler
│   ├── queue/          # pg-boss workers
│   ├── state-machine/  # Process status transitions
│   └── utils/          # Date utils, helpers
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
```

## Licenca

Projeto privado - Grupo Uni.co. Todos os direitos reservados.
