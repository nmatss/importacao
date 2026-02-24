# API - Backend Node.js

API REST principal do sistema de importacao, construida com Express.js e TypeScript.

## Stack

- **Node.js 20+**
- **Express.js** (HTTP server)
- **TypeScript** (tipagem estatica)
- **Drizzle ORM** (PostgreSQL)
- **JSON Web Token** (autenticacao)
- **Google APIs** (Drive, Gmail, OAuth, Groups)
- **OpenRouter** (IA para analise de documentos)

## Modulos

| Modulo | Descricao |
|--------|-----------|
| `auth` | Autenticacao JWT + Google OAuth, controle por Google Groups |
| `processes` | CRUD de processos de importacao com workflow de status |
| `documents` | Upload, armazenamento e gestao de documentos |
| `validation` | Validacao automatizada de documentos |
| `espelhos` | Geracao de espelhos de importacao |
| `ai` | Analise de documentos com IA (OpenRouter) |
| `communications` | Envio de emails via SMTP/Gmail |
| `email-ingestion` | Importacao automatica de emails (IMAP/Gmail API) |
| `follow-up` | Rastreamento de processos |
| `alerts` | Sistema de alertas por severidade |
| `audit` | Log de auditoria completo |
| `dashboard` | Metricas e indicadores |
| `currency-exchange` | Controle de taxas de cambio |
| `settings` | Configuracoes do sistema |
| `integrations` | Integracao Odoo via XML-RPC |

## Estrutura

```
apps/api/src/
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── auth.middleware.ts
│   ├── processes/
│   ├── documents/
│   ├── ai/
│   └── ...
├── shared/
│   └── database/
│       ├── schema.ts        # Schema Drizzle (todas as tabelas)
│       ├── connection.ts    # Conexao PostgreSQL
│       └── migrations/      # Arquivos de migracao
├── app.ts                   # Configuracao Express (CORS, middlewares)
├── routes.ts                # Rotas centralizadas
└── server.ts                # Entry point
```

## Workflow de Processos

```
draft → documents_received → validating → validated → espelho_generated
    → sent_to_fenicia → li_pending → completed
    └──────────────────────────────→ cancelled
```

## Schema do Banco

Tabelas principais gerenciadas pelo Drizzle ORM:

- `users` - Usuarios com roles (admin, analyst)
- `import_processes` - Processos de importacao
- `process_items` - Itens/SKUs de cada processo
- `documents` - Documentos anexados
- `validation_results` - Resultados de validacao
- `espelhos` - Espelhos gerados
- `communications` - Historico de comunicacoes
- `currency_exchanges` - Taxas de cambio
- `follow_up_tracking` - Acompanhamento
- `alerts` - Alertas do sistema
- `audit_logs` - Log de auditoria
- `system_settings` - Configuracoes
- `email_ingestion_logs` - Log de emails importados

## Comandos

```bash
# Desenvolvimento
npm run dev           # Inicia com hot-reload

# Build
npm run build         # Compila TypeScript

# Banco de dados
npm run db:generate   # Gera migracoes a partir do schema
npm run db:migrate    # Aplica migracoes pendentes
npm run db:seed       # Seed de dados iniciais
```

## Autenticacao

1. Login via Google OAuth (frontend)
2. Token ID do Google e enviado ao backend
3. Backend valida e verifica pertencimento ao Google Group autorizado
4. JWT proprio e emitido para sessao
5. Todas as rotas protegidas requerem JWT no header `Authorization: Bearer <token>`

## Variaveis de Ambiente

Ver `.env.example` na raiz do projeto para a lista completa.
