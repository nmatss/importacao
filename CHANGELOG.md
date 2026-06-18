# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] - 2026-06-17 - Harness operacional e validacao documental

### Added

- `AGENTS.md` com regras permanentes para agentes: contexto obrigatorio, workflow,
  seguranca, qualidade, git/deploy e formato de auditoria ampla.
- `docs/HARNESS_PROMPT.md` com prompt mestre portavel para Codex/Qwen/Llama.
- Memorias operacionais em `docs/PROJECT_MEMORY.md` e `docs/SESSION_MEMORY.md`.
- Backlogs vivos em `docs/KNOWN_ISSUES.md`, `docs/TECH_DEBT.md` e `docs/ROADMAP.md`.
- Documentacao de referencia: `ARCHITECTURE`, `BUSINESS_RULES`, `DATABASE`,
  `API`, `SECURITY`, `DEPLOY`, `OBSERVABILITY` e `PERFORMANCE`.
- `docs/ADR/README.md` como compatibilidade para referencias a `docs/ADR/`,
  mantendo `docs/adr/` como diretorio canonico.
- Assistente operacional RAG em `/importacao/assistente`, com rota
  autenticada `POST /api/assistant/query`, fontes internas e fallback
  deterministico.
- Balao flutuante do Assistente IA nos layouts de Importacao e Certificacoes,
  reutilizando `POST /api/assistant/query` sem interromper formularios ou
  navegacao.
- Exportacao CSV para Central de Alertas e Atendimentos usando os filtros
  ativos da tela.
- Utilitario compartilhado `apps/web/src/shared/lib/csv.ts`.

### Fixed

- Acao "Enviar para Fenícia" do espelho agora cria a comunicacao, envia SMTP real com allowlist/anexos auditaveis e so marca o espelho/processo apos sucesso.
- Inicializacao da API passa a conectar o cache Redis em runtime fora de testes e encerra Redis junto da fila no shutdown.
- Checklist de validacao diferencia falhas abertas de aceites manuais.
- Geracao de email de correcao depende apenas de falhas abertas.
- FOB reconhece FOC/desconto por campos alternativos, flag explicita, preco zero
  e desconto negativo.
- Normalizacao de portos cobre acento, pais/sigla, parenteses e evita prefixo inseguro.
- Revisao UX/UI remove busca global falsa dos sidebars e inclui `Meu Dia` na navegacao.
- Titulos e breadcrumbs do detalhe/edicao de processo foram alinhados.
- Skip link global passou a ter alvo real em Login, Portal, Importacao e Certificacoes.
- Lista de processos, filtros de data, abas do detalhe, lista de documentos e botoes de layout ganharam melhorias de acessibilidade.
- Detalhe de processo evita refetch duplicado de e-mails e cambios quando os dados ja foram carregados para indicadores.
- Card de Informacoes do Processo deixou de repetir bloco bruto de dados extraidos ja disponivel na aba Documentos.
- Nomenclatura revisada em telas centrais de importacao: Atendimentos,
  Central de Alertas, auditoria, validacao, LIs, cambios, e-mails, documentos,
  follow-up e dashboards.
- Assistente operacional deixa de retornar dados recentes quando nao ha fonte
  com evidencia positiva para a pergunta.
- Aba de e-mails do processo passou a usar filtro backend por processo, evitando
  contador e historico parciais.
- Exportacao CSV de Alertas e Atendimentos passou a buscar todas as paginas dos
  filtros ativos antes de gerar o relatorio.
- Editor do e-mail de correcao usa o corpo atual digitado mesmo quando o usuario
  salva ou envia sem sair do campo.
- Busca manual de e-mails fica visivel apenas para administradores, alinhada a
  permissao da API.
- Deploy passa a validar o compose remoto antes de migrations/restart, abortar
  se migrations falharem e usar healthchecks com readiness real de API/cert-api.
- Backup inclui o volume `cert-certs` com PDFs/evidencias de certificacao.
- Incoterm e moeda da invoice aceitam variantes comerciais comuns sem gerar falso positivo.
- `dates-match` deixou de tratar `invoiceDate` como data de ETD/embarque.
- Delete e reprocessamento de documento agora recalculam `aiExtractedData`
  consolidado do processo para evitar dados obsoletos.
- Extração de documentos agora usa fila durável `ai-extraction`, captura falhas
  de leitura/parsing antes da IA, classifica documentos presos como `failed`
  apos timeout operacional e bloqueia reprocessamento concorrente.
- Lista de documentos ganhou timeout/estado de carregamento para abrir/baixar
  PDF, evitando acao visualmente infinita em arquivo lento ou indisponivel.
- Comparativo de documentos passou a preferir o documento mais recente,
  processado e sem falha por tipo, evitando usar invoice pendente/obsoleta.
- Documentos processados sem nenhum dado útil extraído agora são tratados como
  falha operacional: não projetam dados no processo, não entram no Comparativo,
  não alimentam validação/anomalias e novas extrações vazias viram
  `extractionFailed` com alerta para reprocessar/reclassificar.
- Inicializacao da fila `pg-boss` agora cria idempotentemente as filas
  `email-send`, `drive-sync`, `sheets-sync` e `ai-extraction` antes de enviar
  jobs, evitando uploads/reprocessamentos presos como pendentes.
- Compose/env de producao passam a exigir `GOOGLE_CLIENT_ID` e
  `VITE_GOOGLE_CLIENT_ID`; destinatarios KIOM/Fenicia/ISA agora sao
  configuraveis em `Configuracoes > Destinatarios operacionais`, com env apenas
  como fallback opcional.
- Chaves privadas Google vindas do SOPS agora são normalizadas mesmo quando
  chegam com `\n` duplamente escapado, evitando falha `ERR_OSSL_UNSUPPORTED`
  no Gmail/Drive/Sheets/Groups/Vertex.
- Validacao e deteccao de anomalias agora usam `draft_bl` como fallback parcial
  quando `ohbl` ainda nao existe, mantendo OHBL como fonte preferencial.
- Integracao Odoo passou a usar URL, database e usuario salvos em
  `system_settings` com fallback para env, mantendo `ODOO_PASSWORD` somente em
  SOPS/env e selecionando XML-RPC HTTP/HTTPS conforme a URL.
- Modal do e-mail de correcao agora recebe foco inicial no destinatario, fecha
  por Escape, mantem Tab dentro do dialogo e devolve foco ao botao de origem.
- Geracao manual de e-mail de correcao agora reusa rascunho KIOM aberto do
  processo, preservando edicoes do operador e evitando duplicidade.
- Envio de comunicacao por API passa a exigir `status=draft`, bloqueando
  reenvio acidental de e-mail ja enviado.
- Envio do espelho para Fenícia no frontend passou a exigir confirmação, mostrar
  estado de envio, bloquear duplo clique e atualizar processo/timeline/e-mails
  apos sucesso.
- Tabela de Produtos de Certificacoes ganhou ordenacao acessivel com botoes
  focaveis e `aria-sort`; filtros visuais passaram a expor `aria-pressed`.
- Switches visuais de agendamentos, status de usuario e seletor de tema passaram
  a declarar estado acessivel (`role="switch"`, `aria-checked`,
  `aria-expanded` e opcoes de tema com `aria-pressed`).
- Upload de documentos deixou de aceitar HTML no frontend/API, bloqueia arquivo
  acima de 50 MB no cliente, valida extensoes permitidas, usa botao acessivel e
  anuncia progresso/erro.
- Download/preview de documentos com conteudo ativo passou a forcar attachment,
  `application/octet-stream` e `X-Content-Type-Options: nosniff`.
- Criada migration SQL pendente para tabelas Pre-Cons e script de migrations
  passou a aplicar `0016_pre_cons_tables.sql`.
- CI passou a buildar/scanear/SBOM da `cert-api`; workflow de deploy passou a
  usar `scripts/deploy.sh` via rsync, alinhado ao modelo operacional real.
- `docker-compose.prod.yml` e cert-api removeram defaults sensiveis de WMS/ERP,
  Sheets e Grafana, exigindo variaveis explicitas em producao.
- Alertmanager ganhou configuracao noop segura e template separado para webhook
  real.
- Rotas internas invalidas de Importacao/Certificacoes passaram a renderizar
  estado 404 contextual em vez de layout vazio; redirect legado `/processos/*`
  preserva caminho profundo.
- Sidebar recolhida, headers de layout, login mobile, filtros, abas de processo,
  linhas navegaveis de tabelas operacionais e botoes icon-only receberam ajustes
  de acessibilidade/layout.
- Formulario de processo e API passaram a validar numeros nao negativos e datas
  coerentes; edicao de processo travado fica bloqueada no frontend.
- Cambio passou a validar valores positivos e datas coerentes no frontend/API.
- Agendamentos de certificacao passaram a validar cron no frontend e na cert-api
  antes de persistir/carregar no APScheduler.
- Produtos, relatorios e agendamentos de certificacao passaram a diferenciar erro
  de API de lista vazia, com alerta e retry.
- Proxy `/cert-api/` passou a exigir JWT valido via `auth_request` em
  `/api/auth/me` antes de injetar a chave interna da cert-api; downloads,
  exports, upload de certificado e stream de validacao agora usam fetch
  autenticado.

### Tests

- Fixture representativa INV/PL/OHBL/FUP roda `allChecks` real, sem mock, e
  falha se um conjunto documental coerente produzir status `failed`.
- Cobertura de regressao garante fallback de `draft_bl` e precedencia de
  `ohbl` em `runAllChecks` e `runAnomalyDetection`.
- Cobertura de regressao garante que extrações vazias/nulas não sejam
  classificadas como documento lido no status da lista, na validação, na
  detecção de anomalias nem no Comparativo.
- Cobertura de regressao garante configuracao Odoo por banco/env e selecao
  correta do client XML-RPC HTTP/HTTPS.
- Cobertura de regressao garante foco/Escape/Tab do modal de e-mail de
  correcao e salvamento do HTML atual do editor sem depender de blur.
- Cobertura de regressao garante reuso de rascunho KIOM aberto e bloqueio de
  reenvio de comunicacao ja enviada.
- Cobertura de regressao garante confirmação e invalidações do envio Fenícia no
  preview do espelho.
- Validacao completa de 2026-06-18: `npm run -w apps/web typecheck`,
  `npm test -w apps/web -- src/features/espelhos/EspelhoPreview.test.tsx`,
  `npm test -w apps/web`, `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, `npm audit --audit-level=high` e
  `docker compose -f docker-compose.prod.yml config --quiet` com variaveis
  obrigatorias dummy.
- Playwright MCP validou o balao do Assistente IA em Importacao/Certificacoes
  desktop/mobile, incluindo envio mockado, fontes, Escape, inferencia de ID de
  processo, ausencia de overflow e ausencia de warnings/erros de console.

### Security

- `cert-api` falha fechado quando `CERT_API_KEY` nao esta configurado; somente `/api/health` e `/api/ready` ficam sem chave para healthchecks.
- Proxy `/cert-api/` do nginx do `web` valida JWT via `/api/auth/me` antes de
  injetar `X-API-Key` a partir de `CERT_API_KEY`, sem expor a chave ao browser.
- `docker-compose.prod.yml` passa a exigir `CERT_API_KEY` para `cert-api` e `web`.
- Acoes criticas de processo/documento/follow-up/espelho passaram a exigir admin: delete de processo, reprocess/delete de documento, sync manual de follow-up, delete de item de espelho, marco/envio Fenícia.
- Cadastro de usuarios no frontend foi alinhado aos papeis suportados (`admin` e `analyst`), removendo criacao visual de `operator`.
- Dependencias com vulnerabilidade alta em audit foram atualizadas ou pinadas em dev/test (`vite`, `form-data`, `@grpc/grpc-js`, `multer`); `npm audit` ficou sem `high`/`critical`.
- Comunicacoes nao aceitam mais anexos com `path` livre vindo da API; envio resolve anexos apenas por documento/espelho do mesmo processo.
- Rascunhos legados com `path` de anexo so sao enviados se o caminho bater com documento/espelho autorizado do processo.
- Trigger, varredura historica e reprocessamento de ingestao de e-mail agora exigem usuario admin.
- Anexos recebidos por e-mail respeitam limite maximo de 50 MB ou `EMAIL_ATTACHMENT_MAX_BYTES`.
- Envio de comunicacoes valida allowlist de destinatarios antes do SMTP e registra
  o usuario real na auditoria/evento.
- Assinatura de e-mail no envio passa a ser buscada pelo usuario autenticado.
- Ingestao de e-mails compara remetente pelo mailbox real normalizado, nao por
  substring no header `From`.
- Auto-sync de Pre-Cons por e-mail valida tamanho, extensao e magic bytes antes
  de processar a planilha.
- Query booleana da ingestao corrige `false` para nao virar `true`.
- `/metrics` pode ser liberado para redes privadas Docker apenas com
  `METRICS_ALLOW_PRIVATE_NETWORKS=true`.

### Verified

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- Deploy de producao do SHA `997aac4` em `192.168.168.124` com API e Web healthy.
- Revisao local posterior: `npm run -w apps/web typecheck`, `npm test -w apps/web`, `npm run -w apps/api typecheck`, `npm test -w apps/api`.
- Revisao completa posterior: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Validacao documental posterior: `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build`, `npm audit --audit-level=high` e
  `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`.

## [2026-06-11] — Parte A: motor financeiro + historização + EAN no espelho

> **Em produção desde 2026-06-11** (PR #58 merged, SHA `96a695c`, migrations 0011→0015 aplicadas). Esta seção e as duas seguintes (2026-06-01 e 2026-05-29) compõem essa entrega.

### Added

- **Motor financeiro** (`modules/financial/`): Valor Aduaneiro = (FOB+frete+seguro)×USD, Numerário = aduaneiro×0,6 + `%numerário` persistidos nas colunas existentes; `GET /api/processes/:id/financials` e `POST …/financials/recompute`; job diário (08:30) com alertas de **Invoice baixa** (<USD 20k), **Seguro/apólice** (>USD 150k → "ACIONAR SEGURADORA") e **demurrage** (free time ≤7 dias/vencido), com dedupe de alertas ativos
- **Historização para auditoria regulatória** (migration `0015`): `validation_result_history` (snapshot append-only de cada run de validação, antes do delete+recreate) e `document_extraction_history` (aiParsedData arquivado antes de reprocess/re-extração); `GET /api/processes/:id/validation-history` e `GET /api/documents/:id/extraction-history`
- **Espelho ancorado em EAN (groundwork)**: extração de `ean` por item na INV e no PL (com regra anti-alucinação), validador GTIN (check digit) no harness, join PL×INV por EAN com fallback para itemCode, enriquecimento via base EAN Puket (`ai/knowledge/ean.json`, só quando o candidato é único) com `eanSource: document|kb`. Layout do XLSX do espelho **inalterado** (pende alinhamento com a Odett)
- `scripts/linx_discovery.py` no cert-api: descoberta de schema do Linx via CLI (`docker exec importacao-cert-api python scripts/linx_discovery.py puket`), sem SSMS

### Changed

- `deploy.sh` aplica as migrations pendentes automaticamente (passo 4.5) via `apply-pending-migrations.sh` (0011→0015)
- Pasta do Drive para a sync da Pre-Cons criada ("Pre-Cons (sync portal importação)", ID `1OJmEV1GTI7vC0B-Uxb-btgQRMDu0530B`) — falta compartilhar com a SA e setar `GOOGLE_DRIVE_PRE_CONS_FOLDER_ID`

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
