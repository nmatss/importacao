# ADR 0004 — Cert-API as a Separate Python Service

**Date**: 2025-02  
**Status**: Accepted

## Context

The certification validation feature requires:
- Oracle WMS connectivity (via oracledb thick mode with Oracle Instant Client 23.7)
- SQL Server ERP connectivity (via pymssql + FreeTDS)
- Complex text extraction and comparison heuristics
- Scheduled background jobs

## Decision

Implement cert validations as a **separate Python 3.12 FastAPI microservice** (`apps/cert-api/`), rather than embedding the logic in the Node.js `apps/api/`.

## Reasoning

- Oracle Instant Client is a native library — requiring it in the Node.js container would add complexity and binary size for a feature used only by cert validation.
- pymssql with FreeTDS is a well-established Python stack for SQL Server; the Node.js ecosystem alternatives (mssql) have had reliability issues with older SQL Server versions.
- Python's `difflib`, `re`, and `gspread` ecosystem made the text matching and Sheets integration straightforward.
- APScheduler provides robust cron-based scheduling without needing an external queue.
- The service can be deployed/restarted independently without affecting the main API.

## Consequences

**Positive**:
- Clean separation — Oracle/MSSQL native dependencies isolated in one container.
- Python ecosystem strength for data processing and text comparison.
- Independent deployment and scaling.

**Negative**:
- Two language runtimes to maintain (TypeScript + Python).
- Cross-service data sharing happens via the shared PostgreSQL database, not in-process.
- Increases Docker Compose complexity (3 app containers instead of 2).
- Requires two separate sets of dependencies, test suites, and CI steps.
