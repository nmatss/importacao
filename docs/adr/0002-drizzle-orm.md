# ADR 0002 — Drizzle ORM instead of Prisma

**Date**: 2025-01  
**Status**: Accepted

## Context

The API needs an ORM for PostgreSQL. Main candidates evaluated: Prisma, Drizzle, Knex, raw pg.

## Decision

Use **Drizzle ORM**.

## Reasoning

- Drizzle generates plain SQL — no magic query engine, no Rust binary, easier to debug.
- Schema is defined in TypeScript close to the domain — no separate `.prisma` files to maintain.
- Migrations are plain SQL files (`drizzle/migrations/`), easy to inspect, modify, and apply manually.
- Bundle size is minimal vs Prisma's large query engine.
- `ALTER TYPE ADD VALUE` (PostgreSQL enums) cannot run in a transaction — Drizzle's plain SQL migrations allow the `docker cp + psql -f` workaround used for migrations 0007+.

## Consequences

**Positive**:
- Full control over generated SQL.
- No external binary dependency.
- Migrations readable and portable.

**Negative**:
- Less "magic" tooling — things like `findUnique` or auto-include relations require manual joins.
- Smaller community and ecosystem vs Prisma at time of decision.
- Relation queries require more explicit SQL than Prisma's nested include API.
