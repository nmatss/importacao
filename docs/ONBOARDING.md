# Onboarding — Importacao Platform

## Prerequisites

- Docker Desktop (or Docker + Docker Compose v2)
- Node.js 22+ and npm
- Python 3.12 (for cert-api local dev)
- Git

## Zero-to-Running

### 1. Clone the repository

```bash
git clone https://github.com/nmatss/importacao.git
cd importacao
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Edit .env — fill in at minimum:
# DATABASE_URL, JWT_SECRET, GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY
# For cert-api: CERT_API_KEY, GOOGLE_SHEETS_*, WMS_ORACLE_*, ERP_MSSQL_PASS
```

### 3. Start all services

```bash
docker compose up -d
# This starts: postgres, api (port 3001), web (port 8080), cert-api (host port 8002)
```

### 4. Access the application

- Web UI: http://localhost:8080
- API: http://localhost:3001
- Cert-API: http://localhost:8002/api/health

### 5. Create first admin user

```bash
# Run the seed (creates the default admin + base system settings)
npm run db:seed
# Or inside the API container:
docker compose exec api npm run db:seed
```

The seed creates a default admin user:

- Email: `admin@importacao.com`
- Password: `admin123`

Change this password immediately after first login.

---

## Monorepo Structure

```
importacao/
  apps/
    api/          # Express 4 + Drizzle ORM backend (TypeScript)
    web/          # React 18 + Vite + Tailwind CSS frontend
    cert-api/     # Python FastAPI certification microservice
  docs/           # Documentation (ADRs, runbook, onboarding)
  scripts/        # Deploy, seed, migration helpers
  docker-compose.yml
  .env            # Single env file shared by all services
```

### apps/api

- Entry point: `src/index.ts`
- Routes: `src/modules/<domain>/routes.ts`
- DB migrations: `drizzle/migrations/` (apply with `npm run db:migrate`)
- Tests: `npm test` (Vitest)

### apps/web

- Entry point: `src/main.tsx`
- Pages: `src/pages/`
- Shared components: `src/components/`
- API calls: `src/api/` (react-query hooks)

### apps/cert-api

- Entry point: `app/main.py`
- See `apps/cert-api/README.md` for full details

---

## Running Tests

```bash
# API tests (Vitest)
cd apps/api && npm test

# Web tests (Vitest)
cd apps/web && npm test

# Cert-API tests (pytest)
cd apps/cert-api
pip install pytest pytest-asyncio pytest-mock httpx
pytest tests/ -v
```

---

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

Types: feat, fix, docs, style, refactor, test, chore
Scopes: api, web, cert-api, db, docker, ci

Examples:
  feat(api): add email signature CRUD endpoints
  fix(web): correct date parsing in process form
  refactor(cert-api): extract cert comparison to service module
  docs: add RUNBOOK and ONBOARDING
```

---

## Pull Request Flow

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make changes, commit frequently with conventional commit messages.
3. Push: `git push origin feat/my-feature`
4. Open a PR on GitHub targeting `master`.
5. Ensure no linting errors: `cd apps/api && npm run lint` / `cd apps/web && npm run lint`.
6. Get at least one review before merging.
7. Squash and merge (or merge commit — team preference).

Deploy to production is manual via `bash scripts/deploy.sh` after merging to `master`.
