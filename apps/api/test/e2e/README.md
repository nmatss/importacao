# E2E Tests — API

These tests use [Testcontainers](https://testcontainers.com/) to spin up a real PostgreSQL instance for each test suite.

## Requirements

- Docker daemon must be running (`docker info` should succeed)
- Tests will be skipped automatically with a clear message if Docker is unavailable

## Running

```bash
# From repo root
npm run test:e2e -w apps/api

# Or from apps/api
cd apps/api && npm run test:e2e
```

## Architecture

Each test file:
1. Starts a PostgreSQL 16 container via `setupE2EDatabase()`
2. Runs all Drizzle migrations against it
3. Creates an Express app instance pointing to that DB
4. Uses `supertest` to make HTTP calls
5. Tears down the container after all tests

Tests are isolated per suite — each file gets its own container.
