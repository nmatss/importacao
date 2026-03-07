# Cert API - Servico de Validacao de Certificacoes

Microservico Python/FastAPI para validacao automatizada de certificacoes de produtos (INMETRO, ANATEL, ANVISA, ABNT) nos e-commerces Puket e Imaginarium via API VTEX.

## Stack

- **Python 3.12**
- **FastAPI** + Uvicorn
- **PostgreSQL** (psycopg2)
- **APScheduler** (agendamento de validacoes)
- **gspread** (Google Sheets)
- **Requests** (VTEX API)

## Endpoints

### Health

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/health` | Status do servico, banco e sheets |

### Sync

| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/sync` | Sincroniza produtos do Google Sheets para o banco |

### Estatisticas

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/stats` | Estatisticas gerais com agregacao por marca |

### Produtos

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/products` | Listagem paginada com filtros (brand, status, search) |
| GET | `/api/products/{sku}` | Detalhe de um produto |
| POST | `/api/products/verify` | Verificacao individual de um SKU |

### Validacao

| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/validate` | Inicia validacao em lote (retorna run_id) |
| GET | `/api/validate/{run_id}` | Status de uma validacao |
| GET | `/api/validate/{run_id}/stream` | SSE - progresso em tempo real |

### Relatorios

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/reports` | Lista relatorios CSV gerados |
| GET | `/api/reports/{filename}` | Download do CSV |
| GET | `/api/reports/{filename}/data` | Dados JSON do relatorio |

### Agendamentos

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/schedules` | Lista agendamentos |
| POST | `/api/schedules` | Criar agendamento (cron expression) |
| PUT | `/api/schedules/{id}` | Atualizar agendamento |
| DELETE | `/api/schedules/{id}` | Remover agendamento |
| POST | `/api/schedules/{id}/run` | Executar agora |
| GET | `/api/schedules/{id}/history` | Historico de execucoes |

## Fluxo de Validacao

```
Google Sheets ──> Sync ──> PostgreSQL (cert_products)
  (inclui coluna                │
  "Descrição E-commerce")       │
                      POST /api/validate
                              │
                   ┌──────────┴──────────┐
                   │  Para cada produto:  │
                   │  1. Busca SKU na     │
                   │     API VTEX         │
                   │  2. Extrai texto de  │
                   │     certificacao     │
                   │     (description,    │
                   │      specs, compl.)  │
                   │  3. Compara com      │
                   │     Desc. E-commerce │
                   │     ou cert_type     │
                   │  4. Emite SSE event  │
                   └──────────┬──────────┘
                              │
                    Gera relatorio JSON
                    Salva resultados no banco
```

## Lojas VTEX Configuradas

| Marca | Store | Host | Campo |
|-------|-------|------|-------|
| Puket Escolares | `puket` | puket.com.br | `complementName` / `description` (ultima frase) |
| Puket | `puket` | puket.com.br | `complementName` / `description` (ultima frase) |
| Imaginarium (proprio) | `lojaimaginarium` | loja.imaginarium.com.br | `description` |
| Imaginarium (marketplace) | `lojaimaginarium` | loja.imaginarium.com.br | `specificationGroups` > "Certificação Inmetro" |

## Orgaos Certificadores Reconhecidos

- **INMETRO** (inclui OCP/BRICS como certificadores acreditados)
- **ANATEL** (codigo de homologacao: `NNNNN-NN-NNNNN`)
- **ANVISA**
- **ABNT**

## Status de Validacao

| Status | Significado | Score |
|--------|-------------|-------|
| `OK` | Certificacao encontrada e correspondente | 0.8 - 1.0 |
| `MISSING` | Produto existe mas sem certificacao | 0.0 |
| `INCONSISTENT` | Certificacao diferente da esperada | 0.3 - 0.7 |
| `URL_NOT_FOUND` | Produto nao encontrado na loja | null |
| `API_ERROR` | Erro ao consultar a API VTEX | null |
| `NO_EXPECTED` | Sem certificacao esperada na planilha | null |

## Tabelas do Banco

```sql
-- Produtos sincronizados do Sheets
cert_products (sku, name, brand, expected_cert_text, ecommerce_description, last_validation_*)

-- Execucoes de validacao
cert_validation_runs (id, status, brand_filter, started_at, finished_at, summary)

-- Resultados individuais
cert_validation_results (run_id, sku, status, score, actual_cert_text, url)

-- Agendamentos cron
cert_schedules (id, name, cron_expression, brand_filter, enabled, last_run, next_run)

-- Historico de execucoes agendadas
cert_schedule_history (id, schedule_id, status, run_date, summary)
```

## Variaveis de Ambiente

| Variavel | Descricao |
|----------|-----------|
| `DATABASE_URL` | URL de conexao PostgreSQL |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Service account email |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Chave privada da service account |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ID da planilha de certificacoes |

## Desenvolvimento Local

```bash
cd apps/cert-api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Docker

```bash
# Junto com os demais servicos
docker compose up cert-api -d

# Build isolado
docker compose build cert-api
```
