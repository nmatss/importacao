# Cert-API

Python 3.12 FastAPI microservice for product certification validation and stock tracking.

## Architecture (after refactor)

```
app/
  main.py           # FastAPI app factory + startup/shutdown (~65 LOC)
  config.py         # All env vars centralized
  utils/
    auth.py         # API key verification via HMAC compare
    logging.py      # Logger config
  db/
    postgres.py     # ThreadedConnectionPool + db() context manager
    oracle.py       # Oracle WMS thick-mode connection (oracledb)
    sqlserver.py    # SQL Server ERP connection (pymssql)
  services/
    cert_service.py # VTEX search + cert text extraction + comparison logic
    erp_service.py  # Google Sheets sync (certifications + licenciados)
    wms_service.py  # WMS + ERP stock sync into cert_stock
    report_service.py # openpyxl Excel report generation
  routes/
    health.py       # GET /api/health, GET /api/ready
    certifications.py # Products, validation runs, stats
    schedules.py    # Cron schedule CRUD + APScheduler integration
    stock.py        # Stock sync, licenciados CRUD
    reports.py      # Report download/export
  models/
    schemas.py      # Pydantic request/response models
tests/
  conftest.py       # Fixtures: mock_oracle_conn, mock_sqlserver_conn, test_client
  test_cert_service.py
  test_health.py
  test_stock.py
  test_routes.py
main.py.legacy      # Original 2938-line monolith kept for reference
```

## Development Setup

### Prerequisites

- Python 3.12
- Oracle Instant Client 23.7 (for WMS integration, set LD_LIBRARY_PATH)
- FreeTDS (for SQL Server via pymssql: `apt-get install freetds-dev`)

### Running locally

```bash
cd apps/cert-api

# With uv (recommended)
pip install uv
uv venv && source .venv/bin/activate
uv pip install -e pyproject.toml

# Or with pip
pip install -r requirements.txt

# Copy .env from repo root — all vars loaded automatically via python-dotenv
uvicorn app.main:app --reload --port 8000
```

### Running tests

```bash
cd apps/cert-api
pip install pytest pytest-asyncio pytest-mock httpx
pytest tests/ -v
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Liveness (no auth required) |
| GET | /api/ready | Readiness (checks DB) |
| GET | /api/stats | Cert validation summary |
| GET | /api/products | List products (paginated + stock enriched) |
| GET | /api/products/{sku} | Single product detail |
| POST | /api/products/verify | Real-time VTEX verification |
| GET | /api/expired | List expired certifications |
| POST | /api/validate | Start batch validation run |
| GET | /api/validate/{run_id} | Get run status |
| GET | /api/validate/{run_id}/stream | SSE progress stream |
| GET | /api/schedules | List cron schedules |
| POST | /api/schedules | Create schedule |
| PUT | /api/schedules/{id} | Update schedule |
| DELETE | /api/schedules/{id} | Delete schedule |
| POST | /api/schedules/{id}/run | Run schedule now |
| GET | /api/schedules/{id}/history | Schedule run history |
| POST | /api/sync-sheets | Trigger Google Sheets sync |
| POST | /api/sync-stock | Trigger WMS + ERP stock sync |
| GET | /api/stock/{sku} | Stock by SKU |
| POST | /api/sync-licenciados | Sync licenciados sheet |
| GET | /api/licenciados | List licenciados (paginated) |
| GET | /api/licenciados/{code} | Licenciados by process code |
| POST | /api/reports/export | Export products Excel |
| POST | /api/reports/export-stock | Export stock Excel |
| GET | /api/reports | List report files |
| GET | /api/reports/{filename} | Download report |

## Environment Variables

| Variable | Description |
|----------|-------------|
| CERT_API_KEY | API key for X-API-Key header (empty = disabled) |
| DATABASE_URL | PostgreSQL connection string |
| GOOGLE_SHEETS_CLIENT_EMAIL | Service account email |
| GOOGLE_SHEETS_PRIVATE_KEY | Service account private key |
| GOOGLE_SHEETS_SPREADSHEET_ID | Spreadsheet ID |
| VTEX_PUKET_DOMAIN | Puket VTEX domain (default: www.puket.com.br) |
| VTEX_IMAGINARIUM_DOMAIN | Imaginarium VTEX domain |
| VTEX_REQUEST_DELAY | Seconds between VTEX requests (default: 1.5) |
| WMS_ORACLE_HOST/PORT/SID/USER/PASS | Oracle WMS credentials |
| ERP_PUKET_HOST/DB, ERP_IMG_HOST/DB | SQL Server ERP connection |
| ERP_MSSQL_USER/PASS | SQL Server credentials |
| CORS_ORIGINS | Comma-separated allowed origins |
| REPORTS_DIR | Path to store generated reports |

## Docker

```bash
docker compose up cert-api -d
docker compose build cert-api
```
