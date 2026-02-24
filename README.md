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

### Diagrama de Comunicacao

```
Browser ──> Nginx (Web)
              ├── /api/* ──────────> Node API ──> PostgreSQL
              ├── /cert-api/* ─────> Cert API ──> PostgreSQL
              │                         ├──> Google Sheets
              │                         └──> VTEX API (tempo real)
              └── /* ──────────────> React SPA
```

## Inicio Rapido

### Pre-requisitos

- Docker e Docker Compose
- Node.js 20+ (para desenvolvimento local)
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
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Acesse: `http://localhost:8085`

## Modulos do Sistema

### Gestao de Importacoes (API + Web)

| Modulo | Descricao |
|--------|-----------|
| **Dashboard** | Visao geral de processos, metricas e alertas |
| **Processos** | CRUD completo de processos de importacao com workflow de status |
| **Documentos** | Upload e gestao de documentos (Invoice, Packing List, BL, Espelho, LI) |
| **Validacao** | Validacao automatizada de documentos com IA (OpenRouter) |
| **Espelhos** | Geracao de espelhos de importacao |
| **Comunicacoes** | Envio de emails via SMTP/Gmail API |
| **Follow-up** | Rastreamento e acompanhamento de processos |
| **Alertas** | Sistema de alertas (info, warning, critical) |
| **Auditoria** | Log completo de acoes dos usuarios |
| **Configuracoes** | Parametros gerais do sistema |
| **Cambio** | Controle de taxas de cambio |
| **Email Ingestion** | Importacao automatica de emails via IMAP/Gmail API |

### Validacao de Certificacoes (Cert API + Web)

| Pagina | Descricao |
|--------|-----------|
| **Dashboard** | Estatisticas gerais, grafico por marca, produtos com problemas |
| **Validacao** | Execucao de validacao em tempo real com progresso via SSE |
| **Produtos** | Listagem completa com filtros, busca e verificacao individual |
| **Relatorios** | Historico de relatorios gerados com download CSV |
| **Agendamentos** | Configuracao de cron jobs com APScheduler |
| **Configuracoes** | Status do sistema, teste de conexao, informacoes |

#### Como Funciona a Validacao

1. **Leitura** - Produtos e certificacoes esperadas sao carregados do Google Sheets
2. **Consulta VTEX** - Cada SKU e buscado em tempo real na API VTEX Intelligent Search
3. **Comparacao** - O texto de certificacao encontrado no site e comparado com o esperado
4. **Resultado** - Cada produto recebe um status:
   - **Conforme** - Certificacao encontrada e correspondente
   - **Ausente** - Produto existe no site mas sem certificacao
   - **Inconsistente** - Certificacao encontrada mas diferente da esperada
   - **Nao Encontrado** - Produto nao encontrado no site (descontinuado)

#### Marcas e Lojas Monitoradas

| Marca | Loja VTEX | Campo de Certificacao |
|-------|-----------|----------------------|
| Puket | puket.com.br | `complementName` |
| Puket Escolares | puket.com.br | `complementName` |
| Imaginarium | loja.imaginarium.com.br | `description` |

## Integracoes

| Servico | Uso |
|---------|-----|
| **Google OAuth** | Autenticacao de usuarios (restrito por dominio/grupo) |
| **Google Drive** | Armazenamento de documentos |
| **Google Sheets** | Fonte de dados de certificacoes |
| **Gmail API** | Ingestao automatica de emails |
| **VTEX API** | Verificacao de certificacoes em tempo real |
| **Odoo** | Integracao ERP via XML-RPC |
| **OpenRouter** | Analise de documentos com IA |

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

## Banco de Dados

PostgreSQL 16 com schema gerenciado pelo Drizzle ORM (API Node) e tabelas adicionais criadas pelo Cert API.

### Tabelas Principais

**API Node (Drizzle):**
`users`, `import_processes`, `documents`, `process_items`, `validation_results`, `currency_exchanges`, `follow_up_tracking`, `espelhos`, `communications`, `alerts`, `audit_logs`, `system_settings`, `email_ingestion_logs`

**Cert API (Python):**
`cert_products`, `cert_validation_runs`, `cert_validation_results`, `cert_schedules`, `cert_schedule_history`

### Migracoes

```bash
npm run db:generate  # Gerar migracoes
npm run db:migrate   # Aplicar migracoes
npm run db:seed      # Seed inicial
```

## Deploy em Producao

### Docker Compose

```bash
# Build e start
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Verificar status
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

### Portas Producao

| Servico | Porta Externa | Porta Interna |
|---------|--------------|---------------|
| Web (Nginx) | 8085 | 80 |
| API Node | 3050 | 3001 |
| Cert API | -- | 8000 |
| PostgreSQL | 5450 | 5432 |

### Nginx Reverso

O frontend Nginx faz proxy reverso para os backends:
- `/api/*` -> Node API (porta 3001)
- `/cert-api/*` -> Cert API (porta 8000, com strip de prefixo)
- `/*` -> SPA React (com fallback para index.html)

### Volumes Persistentes

- `pgdata` - Dados do PostgreSQL
- `uploads` - Documentos uploaded
- `cert-reports` - Relatorios CSV de certificacao

## Desenvolvimento

### Estrutura do Frontend

```
apps/web/src/
├── features/           # Modulos por funcionalidade
│   ├── auth/           # Login, autenticacao
│   ├── portal/         # Portal de selecao de modulos
│   ├── certificacoes/  # Modulo de certificacoes completo
│   ├── dashboard/      # Dashboard principal
│   ├── processes/      # Gestao de processos
│   └── ...
├── shared/
│   ├── components/     # Componentes reutilizaveis
│   ├── hooks/          # React hooks customizados
│   └── lib/            # Utilitarios e API clients
└── main.tsx            # Entry point
```

### Estrutura do Backend

```
apps/api/src/
├── modules/            # Modulos de dominio
│   ├── auth/           # Autenticacao JWT + Google OAuth
│   ├── processes/      # CRUD de processos
│   ├── documents/      # Upload e gestao de documentos
│   ├── ai/             # Integracao OpenRouter
│   └── ...
├── shared/
│   └── database/       # Schema Drizzle, conexao
├── app.ts              # Configuracao Express
├── routes.ts           # Rotas centralizadas
└── server.ts           # Entry point
```

### Scripts

```bash
npm run dev:api       # Dev API com hot-reload
npm run dev:web       # Dev frontend com Vite HMR
npm run build:api     # Build API
npm run build:web     # Build frontend
npm run docker:up     # Docker Compose up
npm run docker:down   # Docker Compose down
npm run docker:build  # Docker Compose build
```

## Licenca

Projeto privado - Grupo Uni.co. Todos os direitos reservados.
