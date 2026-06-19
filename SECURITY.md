# Security Policy

This document describes the security posture of the import-management and
certification platform. It is grounded in the source code; each control cites
the file that implements it. Paths are relative to the repository root.

The platform has three deployable components:

- **`apps/api`** — Node.js / Express / Drizzle ORM over PostgreSQL (the main API).
- **`apps/web`** — React single-page front end.
- **`apps/cert-api`** — Python / FastAPI service for product certification,
  which also talks to SQL Server (Linx ERP).

---

## Authentication

- **JWT, HS256.** Sessions are stateless JWTs signed with `JWT_SECRET`
  (`jsonwebtoken`). Tokens are issued on password and Google login and carry
  only `{ id, email, role }`
  (`apps/api/src/modules/auth/service.ts`). Default expiry is 24h
  (`JWT_EXPIRES_IN`, default `24h`).
- **Secret length enforced at boot.** `JWT_SECRET` must be at least 16
  characters or environment validation fails fast and the process refuses to
  start (`apps/api/src/shared/config/env.ts`,
  `JWT_SECRET: z.string().min(16, ...)`). The auth service additionally throws
  at module load if `JWT_SECRET` is unset
  (`apps/api/src/modules/auth/service.ts`).
- **bcrypt password hashing.** Passwords are hashed with `bcryptjs` (cost factor
  10) on user creation, update, and Google first-login provisioning
  (`apps/api/src/modules/auth/service.ts`). Plaintext passwords are never
  stored; only `passwordHash` is persisted.
- **Per-request `isActive` re-check.** On every authenticated request the
  middleware verifies the JWT signature and then re-reads the user's `isActive`
  flag from the database, rejecting deactivated accounts with 401 even if their
  token is otherwise still valid
  (`apps/api/src/shared/middleware/auth.ts`). Deactivation therefore takes
  effect immediately rather than waiting for token expiry. User deletion is a
  soft-delete that flips `isActive` to false
  (`apps/api/src/modules/auth/service.ts`).
- **Google sign-in.** Google ID tokens are verified with `google-auth-library`
  against `GOOGLE_CLIENT_ID`; an optional `ALLOWED_DOMAIN` restricts accepted
  email domains and group membership is checked before access is granted
  (`apps/api/src/modules/auth/service.ts`). `GOOGLE_CLIENT_ID` is required in
  production (`apps/api/src/shared/config/env.ts`).
- **Audited login failures.** Failed password logins, failed Google logins
  (deactivated account, not-in-group) and successful logins are written to the
  audit log via `auditService.log(...)`
  (`apps/api/src/modules/auth/service.ts`).

## Authorization

- **Auth enforced on every API module.** Every API router except the public
  health probe applies `authMiddleware`: 20 of the 21 module route files under
  `apps/api/src/modules/*/routes.ts` import and mount it; the only exception is
  `apps/api/src/modules/health/routes.ts`. The publicly reachable endpoints are
  `GET /api/health`, `GET /health`, `GET /health/live`, and `GET /health/ready`
  (`apps/api/src/routes.ts`, `apps/api/src/app.ts`,
  `apps/api/src/modules/health/routes.ts`).
- **Admin-only mutations.** Privileged operations (user management, admin
  module) additionally require `adminMiddleware`, which returns 403 unless
  `req.user.role === 'admin'`
  (`apps/api/src/shared/middleware/auth.ts`,
  `apps/api/src/modules/auth/routes.ts`).
- **cert-api global, fail-closed API-key auth.** The FastAPI app registers
  `verify_api_key` as an app-wide dependency, so it runs on every route
  (`apps/cert-api/app/main.py`, `dependencies=[Depends(verify_api_key)]`).
  The verifier (`apps/cert-api/app/utils/auth.py`):
  - exempts only `/api/health` and `/api/ready`;
  - **fails closed** — if `CERT_API_KEY` is not configured it logs an error and
    returns `503`, refusing the request rather than allowing it through;
  - compares the supplied `X-API-Key` against the configured key with
    `hmac.compare_digest`, a constant-time comparison that avoids timing
    side-channels, returning `403` on mismatch.

## Secrets management

- **`.env` is gitignored.** Local environment files are excluded from version
  control (`.gitignore`).
- **Encrypted secrets with SOPS + age.** Production secrets live in
  `.env.sops.yaml`, encrypted with [SOPS](https://github.com/getsops/sops) using
  an `age` recipient configured in `.sops.yaml`. Decryption produces the runtime
  `.env` (`bash scripts/generate-env-from-vault.sh --sops`).
- **Example file holds placeholders only.** `.env.example` ships placeholder
  values (e.g. `JWT_SECRET=change-me-to-a-random-secret-in-production`,
  `*_PRIVATE_KEY=your-private-key`, `GRAFANA_ADMIN_PASSWORD=CHANGE_ME_...`) — no
  real credentials.
- **Log redaction.** The shared pino logger redacts secret-bearing keys
  (`authorization`, `token`, `password`, `apiKey`, `privateKey`,
  `IA_LOCAL_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_VERTEX_PRIVATE_KEY`,
  `GOOGLE_DRIVE_PRIVATE_KEY`, request `authorization` headers) with `[REDACTED]`
  as defense-in-depth (`apps/api/src/shared/utils/logger.ts`).
- **Masked recipient logging.** When the communications module logs or surfaces
  an email recipient (e.g. an allow-list rejection), the address is masked to
  first-character-plus-domain, e.g. `eduarda@kiom.com` → `e***@kiom.com`
  (`apps/api/src/modules/communications/service.ts`).

## Input validation and injection defense

- **Zod request validation.** Inbound request bodies are validated with Zod
  schemas via the `validate` middleware on auth and other routes
  (`apps/api/src/modules/auth/routes.ts`, schemas in each module's `schema.ts`).
  Environment variables are likewise validated through a Zod schema at boot
  (`apps/api/src/shared/config/env.ts`).
- **Parameterized SQL (api).** Database access goes through Drizzle ORM, which
  emits parameterized queries; raw SQL uses the tagged `sql` template
  (`apps/api/src/app.ts`, `sql\`SELECT 1\``).
- **Parameterized SQL (cert-api).** SQL Server and PostgreSQL access uses
  `pymssql` / `psycopg` with bound parameters (`%s` placeholders), e.g. the Linx
  product-property upsert binds product code, property code, and value as
  parameters (`apps/cert-api/app/db/sqlserver.py`,
  `apps/cert-api/app/db/postgres.py`).
- **Identifier allowlist.** Where table/column names must be interpolated into
  SQL (they come from server-side config, never request input), they are
  hard-validated against a strict regex
  (`^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$`) before use, raising `ValueError` on
  anything else (`_ident` in `apps/cert-api/app/db/sqlserver.py`).
- **HTML sanitization.** Inbound communication HTML is stripped of `<script>` /
  `<style>` blocks, inline `on*` event handlers, and dangerous elements
  (`iframe`, `object`, `embed`, `form`, `svg`, `math`, ...) before storage/use
  (`apps/api/src/modules/communications/service.ts`). Email header values are
  stripped of CR/LF to prevent header injection.

## File uploads

- **api (`apps/api/src/shared/middleware/upload.ts`):**
  - `multer` with a **50 MB** size limit.
  - MIME allow-list (PDF, Excel, Word, common images, CSV/TXT, EML/MSG) enforced
    in `fileFilter`, with an extension fallback for browser MIME quirks.
  - Stored filenames are randomized (`crypto.randomUUID()`), so attacker-chosen
    names cannot drive the storage path.
  - **Magic-byte sniffing** (`validateMagicBytes`, run after multer) reads the
    file signature with `file-type` and rejects files whose real content does
    not match the declared/allowed MIME, deleting the rejected upload. (XML/text
    formats that lack a reliable signature are skipped intentionally.)
- **cert-api (`apps/cert-api/app/routes/certificates.py`, `_save_pdf`):**
  - Accepts only `.pdf` by extension.
  - Enforces a **15 MB** limit, both from the multipart-reported size and after
    reading the body.
  - Sniffs content: rejects anything that does not start with the `%PDF-`
    signature.

## SSRF and external calls

- **Operator-configured AI endpoints only.** The AI provider base URLs come from
  operator environment variables, not from requests. The local provider
  validates its endpoint against a host allow-list before any call:
  `assertAllowedEndpoint` parses `IA_LOCAL_BASE_URL` and throws unless the
  hostname is in `IA_LOCAL_ALLOWED_HOSTS` (default
  `ia-local-gateway, localhost, 127.0.0.1, ::1`)
  (`apps/api/src/modules/ai/providers/ialocal.ts`).
- **No user-controlled URL or model.** The AI controller accepts only
  `documentId`, `type`, `text`, and `processId` style fields and validates
  `type` against a fixed list; there is no request parameter that selects a URL,
  host, or model (`apps/api/src/modules/ai/controller.ts`).
- **External-provider opt-in gate.** External AI providers (`vertex`,
  `openrouter`) are refused unless `AI_ALLOW_EXTERNAL=true` is set explicitly —
  enforced both at boot in env validation and again in the `AIService`
  constructor (`apps/api/src/shared/config/env.ts`,
  `apps/api/src/modules/ai/service.ts`). The default provider is the
  on-premise `ialocal`, keeping sensitive import documents inside the perimeter.

## Network and transport

- **Security headers.** `helmet()` is applied globally, setting standard
  security/CSP-related response headers (`apps/api/src/app.ts`).
- **CORS, fail-fast.** In production the API refuses to start if `CORS_ORIGIN`
  is unset (no localhost fallback); otherwise it serves the configured
  comma-separated origin list with credentials enabled
  (`apps/api/src/app.ts`). cert-api restricts CORS to configured origins and to
  `GET/POST/OPTIONS` (`apps/cert-api/app/main.py`).
- **Tight JSON body limit.** JSON and urlencoded bodies are capped at 2 MB to
  reduce the DoS surface on unauthenticated endpoints; large payloads go through
  the separate multer upload path (`apps/api/src/app.ts`).
- **`/metrics` is protected.** The Prometheus endpoint requires either a
  matching `x-metrics-token` (`METRICS_TOKEN`) or a client IP in the allow-list,
  which defaults to loopback only and can be widened via `METRICS_ALLOWED_IPS`
  (or `METRICS_ALLOW_PRIVATE_NETWORKS=true`). IP comparison is by normalized
  equality, treating IPv4-mapped IPv6 as equivalent
  (`apps/api/src/app.ts`).

## Rate limiting and reverse-proxy trust

- **Per-IP / per-user limiting.** `createRateLimiter` throttles by user id (when
  authenticated) or client IP, backed by Redis, and emits standard
  `X-RateLimit-*` / `Retry-After` headers
  (`apps/api/src/shared/middleware/rate-limit.ts`). Login is limited to 5
  attempts / 15 min and Google login to 10 / 15 min
  (`apps/api/src/modules/auth/routes.ts`).
- **Auth endpoints fail closed.** If the Redis store errors, non-sensitive
  endpoints fail open (availability preferred), but authentication endpoints
  (`/auth/login`, `/auth/google`) are **always** treated as fail-closed: a
  per-process in-memory fallback limiter takes over so brute-force protection
  cannot silently disappear during a cache outage
  (`apps/api/src/shared/middleware/rate-limit.ts`,
  `AUTH_PATH_PATTERN` / `checkFallback`).
- **Configurable proxy trust.** `app.set('trust proxy', ...)` is driven by
  `TRUST_PROXY` (default `loopback`) so `req.ip` reflects the real client behind
  the reverse proxy. The code deliberately does **not** blindly trust all
  proxies, which would let any client spoof `X-Forwarded-For`; numeric values
  are treated as a hop count and other values as Express trust-proxy
  expressions (`apps/api/src/app.ts`). Correct `req.ip` is what per-IP rate
  limiting and the `/metrics` allow-list depend on.
- **cert-api rate limiting.** cert-api uses `slowapi` keyed by remote address,
  applying `5/minute` limits on certification write endpoints
  (`apps/cert-api/app/routes/certifications.py`,
  `apps/cert-api/app/main.py`).

### Recent hardening (enterprise review)

This review round applied the following security fixes (see git history on this
branch):

- **Fail-closed auth rate limiting + configurable trust proxy** — auth endpoints
  now fall back to an in-process limiter instead of failing open when Redis is
  down, and proxy trust is no longer hard-coded; `TRUST_PROXY` (default
  loopback) makes `req.ip` reflect the real client for per-IP limits and the
  `/metrics` allow-list (`apps/api/src/shared/middleware/rate-limit.ts`,
  `apps/api/src/app.ts`; commit `fix(security): fail-closed auth rate limiting
  on store outage + configurable trust proxy`).
- **Masked recipient logging** — the communications module now masks email
  addresses in logs and in the actionable 403 returned on allow-list rejection
  (`apps/api/src/modules/communications/service.ts`; commit
  `feat(communications): actionable 403 + masked logging`).
- **`/metrics` allow-list tightened** — IP matching changed from a loose
  `endsWith` to normalized exact-equality (with IPv4-mapped IPv6 handling), so a
  client IP can no longer accidentally match the allow-list by suffix
  (`apps/api/src/app.ts`).
- **cert-api auth fails closed** — protected cert-api routes return `503` when
  `CERT_API_KEY` is unset rather than serving unauthenticated, and use a
  constant-time key comparison (`apps/cert-api/app/utils/auth.py`).
- **Upload content sniffing** — magic-byte verification on api uploads and
  `%PDF-` signature checks on cert-api PDF uploads reject content-type forgery
  (`apps/api/src/shared/middleware/upload.ts`,
  `apps/cert-api/app/routes/certificates.py`).
- **Linx SKU→produto resolution fails closed** — refuses to write a
  `PROP_PRODUTOS` row keyed by an unresolved grade-level SKU rather than
  polluting production (`apps/cert-api/app/db/sqlserver.py`).

---

## Reporting a vulnerability

This project does not run a public bug-bounty program. If you discover a
security issue, please report it privately and responsibly to the repository
owner (the maintainer of this repository), rather than opening a public issue or
pull request. Include enough detail to reproduce the problem (affected
component, request/response, and impact). Please allow reasonable time for a fix
before any public disclosure.
