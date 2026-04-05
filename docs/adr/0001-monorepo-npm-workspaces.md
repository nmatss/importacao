# ADR 0001 — Monorepo with npm Workspaces

**Date**: 2025-01  
**Status**: Accepted

## Context

The platform consists of multiple related services: an API, a web frontend, and a Python microservice. The team is small (1-3 engineers) and these services share configuration, deployment scripts, and development context.

## Decision

Use a monorepo managed with npm workspaces (`apps/api`, `apps/web`). The Python service (`apps/cert-api`) lives in the same repo but uses its own package manager.

A single `.env` file at the root is shared by all services, simplifying local setup and reducing secret duplication.

## Consequences

**Positive**:
- Single `git clone` gets everything.
- Shared scripts (deploy, migrate) live in one place.
- Atomic commits that span API + frontend changes.
- One CI configuration file covers all services.

**Negative**:
- `npm install` at root installs all workspace dependencies — heavier than per-service installs.
- Build cache is coarser — changes to `apps/api` trigger full workspace install in CI.
- Python service doesn't participate in npm workspaces, so `apps/cert-api` deps are managed separately.
