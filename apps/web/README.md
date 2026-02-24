# Web - Frontend React

Single Page Application (SPA) para o sistema de importacao, com modulo completo de validacao de certificacoes.

## Stack

- **React 18** (UI)
- **TypeScript** (tipagem)
- **Vite 6** (build + HMR)
- **Tailwind CSS 4** (estilizacao)
- **React Router 7** (rotas)
- **TanStack React Query** (data fetching)
- **React Hook Form + Zod** (formularios + validacao)
- **Recharts** (graficos)
- **Lucide React** (icones)

## Estrutura

```
apps/web/src/
├── features/
│   ├── auth/              # Login com Google OAuth
│   ├── portal/            # Portal de selecao de modulos
│   ├── certificacoes/     # Modulo de certificacoes
│   │   ├── CertDashboardPage.tsx
│   │   ├── CertValidacaoPage.tsx
│   │   ├── CertProdutosPage.tsx
│   │   ├── CertProdutoDetailPage.tsx
│   │   ├── CertRelatoriosPage.tsx
│   │   ├── CertRelatorioDetailPage.tsx
│   │   ├── CertAgendamentosPage.tsx
│   │   ├── CertConfiguracoesPage.tsx
│   │   └── components/
│   │       ├── CertStatsCards.tsx
│   │       ├── CertStatusBadge.tsx
│   │       ├── CertBrandChart.tsx
│   │       └── CertValidationProgress.tsx
│   ├── dashboard/
│   ├── processes/
│   ├── documents/
│   └── ...
├── shared/
│   ├── components/
│   │   └── CertificacoesLayout.tsx   # Layout sidebar
│   ├── hooks/
│   │   └── useAuth.ts
│   └── lib/
│       ├── cert-api-client.ts        # API client certificacoes
│       └── utils.ts                  # Utilitarios gerais
├── main.tsx
└── index.css
```

## Modulo de Certificacoes

### Paginas

| Pagina | Rota | Descricao |
|--------|------|-----------|
| Dashboard | `/certificacoes` | Visao geral com stats, grafico por marca, problemas |
| Validacao | `/certificacoes/validacao` | Iniciar validacao com filtro de marca, progresso SSE |
| Produtos | `/certificacoes/produtos` | Listagem paginada, filtros, verificacao individual |
| Detalhe Produto | `/certificacoes/produtos/:sku` | Informacoes completas do produto |
| Relatorios | `/certificacoes/relatorios` | Lista de relatorios CSV |
| Detalhe Relatorio | `/certificacoes/relatorios/:id` | Resultados com filtros e download |
| Agendamentos | `/certificacoes/agendamentos` | CRUD de cron jobs |
| Configuracoes | `/certificacoes/configuracoes` | Status do sistema |

### Funcionalidades

- Validacao em tempo real via Server-Sent Events (SSE)
- Progresso visual com barra e log de eventos
- Filtros por marca (Imaginarium, Puket, Puket Escolares)
- Status traduzidos para portugues (Conforme, Ausente, Inconsistente, etc.)
- Agendamento com cron expressions e APScheduler
- Download de relatorios CSV
- Verificacao individual de produtos

## Desenvolvimento

```bash
# Dev server com HMR
npm run dev           # http://localhost:5173

# Build producao
npm run build         # Gera dist/
```

### Proxy Dev (vite.config.ts)

- `/api` -> `http://localhost:3001` (Node API)
- `/cert-api` -> `http://localhost:8000` (Cert API)

## Build Producao

Multi-stage Docker:
1. Stage `builder` - Node 20, npm ci, vite build
2. Stage `production` - Nginx Alpine servindo o dist/

O Nginx faz proxy reverso para os backends (ver `nginx.conf`).

## Interface

- Design system com Tailwind CSS
- Paleta emerald/slate
- Componentes com gradientes, sombras e animacoes
- Layout responsivo com sidebar colapsavel
- Tema consistente entre todos os modulos
