# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — 2026-04-05

### Added
- Cert-API refactored from 2938-line monolith into modular structure (`app/`)
- pytest test suite for cert-api (test_cert_service, test_health, test_stock, test_routes)
- `pyproject.toml` for cert-api with uv-compatible dependency management
- `docs/RUNBOOK.md` — troubleshooting, rollback, backup/restore procedures
- `docs/ONBOARDING.md` — zero-to-running setup guide
- `docs/adr/` — 5 Architecture Decision Records
- `apps/cert-api/docs/DEVELOPMENT.md` — cert-api development guide
- `apps/cert-api/README.md` updated with new architecture
- `/api/ready` readiness endpoint in cert-api

---

## [2.5.0] — 2026-04-03 (6cb6f75)

### Added
- `animate-fade-in` to SettingsPage
- Premium UI polish: shimmer skeletons, Apple cubic-bezier transitions, micro-interactions
- All MEDIUM pentest findings fixed (rate limiting, security headers, XSS)

### Fixed
- XSS: DOMPurify.sanitize() on all dangerouslySetInnerHTML
- SMTP: TLS rejectUnauthorized=true in production + CRLF injection sanitization
- Auth: password minimum 8 chars, failed login audit logging

---

## [2.4.0] — 2026-04-03 (14ff181)

### Added
- Enterprise design system v2: semantic color tokens, Inter font, sidebar navy
- Banned raw color classes (blue-*, red-*, gray-*) — replaced with semantic tokens
- Shimmer loading skeletons, layered card shadows, stagger-children animations

---

## [2.3.0] — 2026-03-xx (4516f33)

### Added
- Pre-Cons module: automatic sync via email + manual upload
- Support for 10+ document formats: Word, TIFF, CSV, HTML, EML, BMP
- Professional AI summaries for extraction results (PT-BR)

### Fixed
- Pre-cons parser: safe number parsing to avoid NaN in database
- Pre-cons quantities rounded to integer (KIOM data has decimals)
- AI comparison using raw { value, confidence } instead of flat values

---

## [2.2.0] — 2026-03-xx (3eabd97)

### Added
- Process timeline/event history (`process_events` table, migration 0009)
- Email signatures CRUD (up to 4 per user, `email_signatures` table, migration 0008)
- Draft BL: upload + 10-item checklist + AI extraction + comparison view
- Logistic flow: 11 stages (consolidation → internalized) with sub-info and manual override

---

## [2.1.0] — 2026-03-xx (b463c74)

### Added
- Cert-API stock integration: WMS Oracle + ERP SQL Server (Puket, Imaginarium)
- Licenciados (LPCO tracking) from Google Sheets
- Validation schedules with cron expressions and APScheduler
- cert_stock table with WMS storage areas and e-commerce stock

### Changed
- Certification comparison: ecommerce_description takes priority over certification_type

---

## [2.0.0] — 2026-03-xx (5b90a34)

### Added
- First complete delivery: document validation + certification + stock
- Cert-API microservice (Python FastAPI) for VTEX certification validation
- Google Sheets integration for certification data (Imaginarium, Puket, Puket Escolares)
- Encerramentos tab support: "Venda até fim do lote" never expires
- Validation runs with SSE progress streaming
- Excel report generation (openpyxl)

---

## [1.5.0] — 2026-02-xx (1c2902d)

### Added
- Complete QA pass: security, performance, visual, DX improvements
- Mobile responsiveness across 15 files
- AI multimodal support for scanned PDFs and images

---

## [1.0.0] — 2026-01-xx (c67760c)

### Added
- Initial technical architecture and execution plan
- Express API with Drizzle ORM and PostgreSQL
- React + Vite frontend with Tailwind CSS
- Docker Compose multi-service setup
- JWT authentication, email ingestion via Gmail API
- Import process management with 11 logistic stages
- Document upload and AI extraction (Gemini 2.5 Flash)
