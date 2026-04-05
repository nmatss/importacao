# Cert-API Development Guide

## Adding a New Endpoint

1. Decide which router file owns the endpoint (`routes/certifications.py`, `routes/stock.py`, etc.).
2. Add the route function with a docstring, type hints, and return type annotation.
3. If it needs a request body, add a Pydantic model to `models/schemas.py`.
4. If it contains business logic, extract it to the appropriate service file.
5. Add a test in `tests/test_routes.py` checking at minimum: auth required, response shape.
6. `include_router` is already done in `app/main.py` — no changes needed there.

## Module Conventions

| Layer | Responsibility | Rules |
|-------|---------------|-------|
| `routes/` | HTTP binding, request/response serialization | No business logic, no SQL |
| `services/` | Business logic, external API calls | No FastAPI imports |
| `db/` | Connection management, raw SQL | No business logic |
| `models/` | Pydantic schema definitions | No logic |
| `config.py` | Env vars, constants | No side effects at import |

## Testing Patterns

All tests use fixtures from `tests/conftest.py`:

- `test_client` — httpx AsyncClient with real FastAPI app, DB mocked out
- `mock_oracle_conn` — patches `oracledb.connect`, returns mock cursor
- `mock_sqlserver_conn` — patches `pymssql.connect`, returns mock cursor
- `mock_db` — patches `app.db.postgres.db` context manager
- `api_key_headers` — `{"X-API-Key": "test-key"}`

```python
@pytest.mark.asyncio
async def test_my_endpoint(test_client, api_key_headers):
    resp = await test_client.get("/api/my-endpoint", headers=api_key_headers)
    assert resp.status_code == 200
```

## Cert Comparison Logic

The priority order in `cert_service.compare_cert_texts()`:

1. If `ecommerce_desc` is set: exact substring/code match (most reliable).
2. Registration number match (`\d{4,}/\d{4}` patterns).
3. Cert body match (inmetro/anvisa/anatel/abnt) + registration number present → OK.
4. Cert body match without registration number → INCONSISTENT.
5. Portaria number match.
6. Word overlap + sequence similarity fallback.

"ENCERRAMENTO" products always return OK — they are in phase-out and may or may not have cert on site.

## Running Linting

```bash
cd apps/cert-api
pip install ruff
ruff check app/ tests/
```
