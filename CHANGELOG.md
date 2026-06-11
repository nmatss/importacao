# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — 2026-06-01 — Cadastro de certificado + escrita no Linx (PROP_PRODUTOS)

### Added

- **Tela "Cadastrar Certificado"** no painel de Certificações (`/certificacoes/cadastro`): formulário com marca/loja, SKU, validade do certificado, vencimento do licenciamento, nº do certificado, OCP, órgão certificador e upload de PDF; lista de recentes + botão "Reenviar ao Linx"
- **Escrita automática no Linx** ao salvar: upsert das datas em `PROP_PRODUTOS` por marca — Puket props `00224`/`00225`, Imaginarium `00106`/`00107` (`linx_service.py` + helpers em `db/sqlserver.py`)
- **API** (`routes/certificates.py`): `POST /api/certificates` (multipart + PDF), `GET /api/certificates`, `GET /api/certificates/{id}`, `GET …/pdf`, `POST …/retry-linx`
- Tabela de auditoria `cert_certificates` (PostgreSQL) com `linx_status`/`linx_error`/`linx_detail`
- Config `LINX_*` parametrizável por env + `python-multipart` como dependência
- `sql/linx_discovery.sql` (query read-only de descoberta de schema) e docs `CERT-LINX-WRITE.md`
- 31 testes (`tests/test_linx_service.py` + `tests/test_certificates_routes.py`): formatação de data, fail-closed, resolução de marca, guarda de identificador SQL (inclui schema-qualificado `dbo.tabela`) e integração das rotas (auth, validação de input, PDF forjado, happy path, retry)
- Índice `cert_certificates(brand, linx_status)` para reprocesso em massa; aviso no formulário quando a data informada está no passado

### Changed

- CI endurecido: lint (api/web) e pytest do cert-api agora bloqueiam o pipeline (removido `|| true`); 42 warnings de ESLint zerados
- SMTP do worker de e-mail valida certificado TLS em produção (override explícito via `SMTP_TLS_REJECT_UNAUTHORIZED=false` para relay interno)
- Login fail-closed: sem `GOOGLE_GROUP_ALLOWED` configurado ninguém entra (allow-all antigo só com `GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET=true` explícito)

### Security

- **Fail-closed**: nada é gravado no Linx enquanto `LINX_WRITE_ENABLED=false` (evita escrever em produção com schema não confirmado); resolução SKU→produto recusa gravar sem mapeamento configurado
- Upsert anti-race/anti-trigger: `UPDATE … WITH (UPDLOCK, HOLDLOCK)` + `SET NOCOUNT ON; SELECT @@ROWCOUNT`; identificadores validados por regex e valores sempre como bind params
- Upload de PDF validado por extensão **e** magic bytes `%PDF-`, limite 15 MB, nome derivado de UUID

---

## [Unreleased] — 2026-05-29 — Camada de confiança da IA + UAT Odett

### Added

- **Provider Vertex AI** ativado em runtime (privacidade por contrato) + teto de custo mensal (R$150 ≈ USD 26); KB copiada para `dist/` no build
- **Harness de confiança da IA** (`ai/harness/`): grounding anti-alucinação, validadores de formato (NCM, container ISO 6346 com check-digit, CNPJ, USD), consistência numérica e validação contra a base de conhecimento; gate força revisão humana em erro
- **Skills por documento** (`ai/skills/`) = schema + receita de verificação
- **Base de conhecimento** (`ai/knowledge/`): NCMs, portos, fornecedores, armadores, tarifas, EAN Puket (extraída da planilha Follow Up)
- Migration `0014` (`validation_results.resolution_note`) registrada em `apply-pending-migrations.sh` + `deploy.sh`
- Job de sync da Pre-Cons no scheduler (aguarda `GOOGLE_DRIVE_PRE_CONS_FOLDER_ID`)
- Docs: `AI-HARNESS.md`, `REVISAO-100.md`, `ODETT-STATUS.md`; testes novos (harness, processor-codes, parse-precons, flatten-ai-data)

### Fixed (UAT Odett IM0712602NB)

- #1 códigos de processo: regex restrito ao formato Uni.co + gate do código sugerido pela IA (não captura mais PI/INV/NCM)
- #2 BL: `issueDate` (data de emissão real) em vez da data de upload rotulada como "emitido"
- #3 descrição da carga expansível nas tabelas comparativas
- #4 declaração de madeira detectada no BL Final
- #7 INV lida: schema alinhado ao prompt + classificação por conteúdo + gate degradável (`hasRelevantData`)
- #8 PL não mistura quantidade com faturamento (regra + check de quantidade inteira)
- #9 checklist de validação com status `skipped` (despoluída)
- #10 "resolver manualmente" exige justificativa + recomputa status
- Pre-Cons: delete em transação (arquivo ruim não zera a tabela); parser validado contra dados reais
- CI: vuln HIGH `tmp` (Path Traversal) resolvida via `npm audit fix`

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
- Banned raw color classes (blue-_, red-_, gray-\*) — replaced with semantic tokens
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
