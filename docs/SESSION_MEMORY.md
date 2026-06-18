# Session Memory

## 2026-06-18 - Revisao Completa Do Fluxo Documental, Leitura E Validacao

Escopo:

- Revisao cruzada de documentacao, memoria, ADRs, fluxo de documentos, leitura,
  comparativo, validacao, upload, reprocessamento, email ingestion e UX.

Correcoes aplicadas:

- Validacao e deteccao de anomalias passaram a escolher o documento vigente:
  mais recente, processado, com `aiParsedData`, sem falha/skipped e com
  confianca operacional minima. OHBL continua preferido; Draft BL e fallback
  quando OHBL valido nao existe.
- Extração com confiança menor que 40% agora salva evidencia no documento, cria
  alerta critico e nao projeta dados para `import_processes.ai_extracted_data`,
  validacao ou espelho automatico.
- Rebuild de dados projetados e comparativo documental ignoram extracoes
  abaixo do piso de confianca operacional.
- Upload, reprocessamento e exclusao de documentos respeitam processo travado
  (`lockedAt`), retornando erro 423 e removendo arquivo temporario de upload
  quando aplicavel.
- Comparativo documental deixou de usar `invoiceDate` como ETD/embarque e
  passou a usar comparacao estrita de portos normalizados, evitando falso match
  como `SANTOS` vs `SANTOS DUMONT`.
- Upload web ganhou timeout, suporte a `.msg`, preserva escolha manual de tipo
  contra autodeteccao por nome, expõe estado acessivel do seletor e invalida
  comparativo/validacao/processo/eventos relacionados.
- Lista de documentos mostra falha de IA de forma acionavel, diferencia docs
  recebidos de extraidos, expõe origem manual/e-mail quando consultada, abre
  fallback de Drive quando arquivo local falha e oculta reprocess/delete de
  usuarios nao admin.
- Ingestao por e-mail passou a usar `randomUUID()` no nome fisico do anexo,
  evitando colisao por mesmo nome no mesmo milissegundo.
- E2E de documentos foi corrigido para a rota real
  `/api/documents/process/:processId`.
- README e RUNBOOK foram reconciliados: producao usa `AI_PROVIDER=ialocal`,
  egress externo exige `AI_ALLOW_EXTERNAL=true`, e rollback do servidor e por
  snapshot/rsync, nao por `git checkout`.

Validacoes executadas ate aqui:

- Suíte completa da API via `npm test -w apps/api`: 570 testes passaram, 1 skip.
- `npm run typecheck`
- `npm run lint`

Pendencias registradas em `docs/TECH_DEBT.md`:

- E2E documental ponta a ponta com upload multipart real e fixtures anonimizadas.
- Versionamento relacional/snapshot de aceite do comparativo.
- Classificador por conteudo para anexos genericos.
- Dedupe atomico/singleton para reprocessamento concorrente.
- Decisao final sobre fallback permissivo vs estrito em schema Zod da IA.

## 2026-06-18 - Deploy Producao E Fechamento Pos-Auditoria

Correcoes finais aplicadas:

- Deploy oficial concluido em producao via `scripts/deploy.sh` no servidor
  `192.168.168.124`, com backup obrigatorio, snapshot de rollback, migrations,
  rebuild/restart e healthchecks.
- Segredos obrigatorios `GOOGLE_SHEETS_SPREADSHEET_ID` e
  `GRAFANA_ADMIN_PASSWORD` foram adicionados no SOPS remoto e o `.env` passou a
  ser gerado com `docker compose config --quiet` valido.
- Destinatarios operacionais foram mantidos em `system_settings`: KIOM e
  Fenicia preenchidos; ISA permaneceu vazio para cadastro pelo negocio em
  Configuracoes.
- O processo `264` permaneceu sem documentos pendentes de processamento apos a
  correcao da invoice presa.
- O runtime Docker da API foi corrigido com `overrides` locais para
  `imapflow`/`mailparser` usarem o `nodemailer` corrigido. O container final
  ficou com `npm audit --omit=dev --audit-level=high` sem vulnerabilidades.

Validacoes finais executadas:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `npm audit --audit-level=high` em `apps/api`
- Instalacao standalone temporaria de `apps/api` com `npm install --omit=dev`
  e audit high.
- `docker build -t importacao-api-audit ./apps/api`
- `docker run --rm --entrypoint sh importacao-api-audit -lc 'cd /app && npm audit --omit=dev --audit-level=high'`
- Deploys oficiais para `de8d688d5b49` e depois `8170d3dc9a0e`.
- Pos-deploy: containers `importacao-api`, `importacao-web`, `importacao-cert-api`,
  `importacao-redis` e `importacao-postgres` saudaveis; `/health/ready` OK;
  cert-api `ready=True`; rota publica `/importacao/processos/264` respondeu
  `HTTP 200`; logs recentes da API sem `error|exception|fatal|unhandled|oauth`.

## 2026-06-18 - Fase De Fechamento De Pendencias E Acessibilidade Residual

Inventario:

- Varredura cruzou `README.md`, `CHANGELOG.md`, `docs/PROJECT_MEMORY.md`,
  `docs/SESSION_MEMORY.md`, `docs/KNOWN_ISSUES.md`, `docs/TECH_DEBT.md`,
  `docs/ROADMAP.md`, `docs/STATUS-2026-06-16.md`,
  `docs/UX_UI_AUDIT_2026-06-17.md`, codigo web/API e estado git.
- Pendencias P0 ainda abertas dependem de decisao externa ou dado operacional:
  provider de IA, cadastro de destinatarios KIOM/Fenicia/ISA em Configuracoes,
  alerta externo de restore/RTO, pasta/credencial Pre-Cons, escrita Linx e regras
  regulatorias de certificacao/licenciamento/estoque.

Correcoes aplicadas:

- Upload/preview de documentos: HTML removido da allowlist, conteudo ativo
  forca download com `nosniff`, upload no frontend valida extensao/tamanho e
  expoe controle acessivel com progresso.
- Pre-Cons: adicionada migration SQL `0016_pre_cons_tables.sql`; script de
  pending migrations aplica a migration; filtros e headers ordenaveis ganharam
  labels/`aria-sort`.
- CI/deploy/infra: cert-api entrou no build/Trivy/SBOM; deploy GitHub Actions
  usa `scripts/deploy.sh`; defaults sensiveis de WMS/ERP/Sheets/Grafana foram
  removidos; Alertmanager ficou noop por padrao com template de webhook real.
- E2E de API: falha de setup em CI deixa de ser skip silencioso.
- Produtos de Certificacoes: cabecalhos ordenaveis viraram botoes focaveis com
  `aria-sort`; filtros de status e marca passaram a expor `aria-pressed`.
- Agendamentos de Certificacoes: toggles de ativacao da lista e do modal passaram
  a usar `role="switch"` e `aria-checked`; acoes icon-only ganharam `type` e
  nomes acessiveis.
- Configuracoes/Usuarios: toggle de usuario ativo passou a expor semantica de
  switch.
- Seletor global de tema: botao declara aberto/fechado e opcoes usam
  `aria-pressed`, sem prometer comportamento ARIA de menu.
- Rotas internas invalidas de Importacao/Certificacoes agora mostram fallback
  contextual; redirect legado `/processos/*` preserva caminho profundo.
- Sidebar recolhida, headers de layout, login mobile, linhas de tabelas
  navegaveis, abas de processo e botoes icon-only receberam ajustes de
  acessibilidade e responsividade.
- Formularios: processo/cambio validam numeros e datas no frontend/API; edicao
  de processo travado bloqueia campos; cron de agendamento e validado no
  frontend/cert-api; telas de certificacao nao mascaram erro de API como lista
  vazia.
- Assistente IA: adicionado balao flutuante nos layouts de Importacao e
  Certificacoes, com consulta ao endpoint existente `/api/assistant/query`,
  atalhos operacionais, fontes internas e inferencia automatica de processo em
  paginas de detalhe.
- Segurança cert-api: proxy `/cert-api/` passou a validar JWT via
  `auth_request` em `/api/auth/me` antes de injetar `X-API-Key`; client web de
  certificacoes passou a usar `Authorization` em chamadas JSON, multipart,
  downloads e stream de validacao.
- Deploy: `scripts/deploy.sh` agora valida `docker compose config --quiet` no
  servidor depois da geracao de `.env` e antes de migrations/restart.
- Incidente processo 264: invoice `2026.02.22 KIOM INV - IM0712602NB (1).pdf`
  estava presa em `is_processed=false`/`ai_parsed_data=null` desde abril; a API
  recebia polling em `/api/documents/process/264` a cada 5s. Correcoes locais:
  extração enfileirada em `ai-extraction`, falhas de `extractText`/PDF/IA viram
  `failed`, documentos presos passam a `failed` apos
  `DOCUMENT_PROCESSING_STALE_MINUTES`, reprocessamento concorrente retorna 409 e
  abertura/download de PDF no frontend tem timeout visual.
- Auth/OAuth: URL `devolucoes.grupounico.com:3091/api/auth/error?OAuthSignin`
  nao pertence ao fluxo deste repo (`POST /api/auth/google`); `devolucoes:3091`
  resolve para outro host/servico. Neste repo, compose/env agora exigem
  `GOOGLE_CLIENT_ID` e `VITE_GOOGLE_CLIENT_ID` em producao.
- Operacao: destinatarios KIOM/Fenicia/ISA agora sao configurados no sistema em
  Configuracoes, com `KIOM_EMAIL`/`FENICIA_EMAIL`/`ISA_EMAIL` apenas como fallback
  opcional.
- Documentacao reconciliada para retirar a acessibilidade corrigida da divida
  aberta e explicitar que secrets/SOPS ja estao configurados, restando governanca
  continua.

Testes e validacoes executados:

- `npm run -w apps/web typecheck`
- `npm test -w apps/web -- src/features/espelhos/EspelhoPreview.test.tsx`
- `npm test -w apps/web`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `POSTGRES_USER=dummy POSTGRES_PASSWORD=dummy POSTGRES_DB=dummy JWT_SECRET=dummy GOOGLE_SHEETS_SPREADSHEET_ID=dummy WMS_ORACLE_HOST=dummy WMS_ORACLE_PORT=1521 WMS_ORACLE_SID=dummy WMS_ORACLE_USER=dummy WMS_ORACLE_PASS=dummy ERP_PUKET_HOST=dummy ERP_PUKET_DB=dummy ERP_IMG_HOST=dummy ERP_IMG_DB=dummy ERP_MSSQL_USER=dummy ERP_MSSQL_PASS=dummy CERT_API_KEY=dummy GRAFANA_ADMIN_PASSWORD=dummy docker compose -f docker-compose.prod.yml config --quiet`
- `bash -n scripts/deploy.sh`
- `bash -n scripts/apply-pending-migrations.sh`
- `npm test -w apps/api -- src/modules/documents/__tests__/controller.test.ts src/shared/middleware/__tests__/upload.test.ts src/modules/pre-cons/__tests__/parse-precons.test.ts`
- `ruff check apps/cert-api/`
- `pytest apps/cert-api/ --tb=short -q`
- `npx eslint` focado nos TSX alterados
- `npx eslint apps/web/src/shared/components/AssistantBubble.tsx apps/web/src/shared/components/ImportacaoLayout.tsx apps/web/src/shared/components/CertificacoesLayout.tsx`
- `docker run ... nginx:alpine ... nginx -t` para `apps/web/nginx.conf`
- Playwright MCP em 28 rotas x desktop/mobile, com mocks de API, verificando
  overflow, controles sem label, botoes sem nome e rotas invalidas.
- Playwright MCP especifico do balao do Assistente IA em Importacao e
  Certificacoes desktop/mobile: abertura, envio para `/api/assistant/query`,
  fontes, Escape, ausencia de overflow/botoes sem nome e ocultacao na pagina
  dedicada `/importacao/assistente`.
- Playwright MCP limpo em `/importacao/processos/123/rota-invalida` confirmou
  inferencia automatica do ID `123`, zero overflow, zero botoes sem nome e zero
  warnings/erros de console.

Observacoes:

- `npm audit --audit-level=high` ficou sem `high`/`critical`; ainda lista 13
  moderadas e 1 baixa transitivas ja registradas em `docs/TECH_DEBT.md`.
- `docker compose config` local passou com variaveis obrigatorias dummy.
- Deploy nao foi executado nesta fase porque `scripts/deploy.sh` exige worktree
  limpa e `master` sincronizado; `HEAD` e `origin/master` estavam iguais
  (`5a99bf3c351122afc111b05566a787f6a47bd7ab`), mas havia alteracoes locais
  nao commitadas.
- Nova politica de compose prod exige variaveis reais para Sheets/WMS/ERP/Grafana
  antes do proximo deploy.
- Checagem remota em 2026-06-18 indicou `.env` atual do servidor com
  `GOOGLE_SHEETS_SPREADSHEET_ID` e `GRAFANA_ADMIN_PASSWORD` ausentes; o deploy
  com o compose novo deve ser bloqueado ate esses segredos existirem.
- Pendencias residuais registradas em `docs/TECH_DEBT.md`: migrar modais
  especificos restantes para Dialog compartilhado, fortalecer forms de
  Settings/Communications/CertCadastro e criar UX mobile dedicada para tabelas
  largas/kanban.

## 2026-06-17 - Confirmacao Do Envio Fenícia No Espelho

Correcoes aplicadas:

- Botao "Enviar para Fenícia" no preview do espelho passou a abrir confirmacao
  antes do POST real.
- Acao mostra estado de envio, bloqueia duplo clique e fica desabilitada quando
  o espelho ja foi enviado.
- Sucesso invalida `espelho`, `process`, `process-events` e `communications`
  para refletir marco operacional, timeline e comunicacao enviada.

Testes focados executados:

- `npm test -w apps/web -- src/features/espelhos/EspelhoPreview.test.tsx`

## 2026-06-17 - Acessibilidade Do Modal De E-mail De Correcao

Correcoes aplicadas:

- Modal de e-mail de correcao passou a focar o campo de destinatario ao abrir.
- Escape fecha o modal e devolve foco ao botao que abriu o rascunho.
- Navegacao por Tab fica contida dentro do dialogo.
- Campos do rascunho ganharam labels/ids acessiveis e o editor HTML ganhou
  `role="textbox"` com `aria-multiline`.
- Geracao manual de e-mail de correcao passou a reutilizar rascunho KIOM aberto
  do mesmo processo, preservando edicoes humanas.
- `communicationService.send` passou a bloquear envio quando a comunicacao nao
  esta mais em `draft`, evitando reenvio acidental por API.

Testes focados executados:

- `npm test -w apps/api -- src/modules/communications/__tests__/service.test.ts`
- `npm test -w apps/web -- src/features/validation/ValidationChecklist.test.tsx`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Odoo Settings DB Com Fallback Env

Correcoes aplicadas:

- `odoo.service` passou a resolver `odoo_url`, `odoo_db` e `odoo_user` a partir
  de `system_settings`, com fallback para `ODOO_URL`, `ODOO_DB` e `ODOO_USER`.
- `ODOO_PASSWORD` permanece somente em SOPS/env, sem campo novo no banco ou UI.
- O client XML-RPC passou a usar `createClient` para URL `http` e
  `createSecureClient` para URL `https`, preservando path base da URL.
- Cache de autenticação Odoo passa a ser reaproveitado apenas enquanto a
  configuração efetiva permanece igual.

Testes focados executados:

- `npm test -w apps/api -- src/modules/integrations/__tests__/odoo.service.test.ts`
- `npm test -w apps/api -- src/modules/integrations/__tests__/odoo.service.test.ts src/modules/validation/checks/__tests__/document-fixture.test.ts`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Fallback De Draft BL Na Validacao

Correcoes aplicadas:

- `runAllChecks` passou a selecionar `ohbl` como BL preferencial e usar
  `draft_bl` apenas como fallback quando OHBL ainda nao existe.
- `runAnomalyDetection` passou a usar a mesma regra, evitando anomalia com BL
  vazio quando so ha Draft BL.
- O fallback nao altera o marco operacional de documento final recebido nem
  libera envio Fenícia/espelho como se OHBL existisse.

Testes focados executados:

- `npm test -w apps/api -- src/modules/validation/__tests__/service.test.ts`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Normalizacao De Chave Google Em SOPS

Correcoes aplicadas:

- Criado `normalizeGooglePrivateKey` para aceitar PEM com quebras reais,
  `\n` escapado ou `\\n` duplamente escapado.
- Drive, Sheets, Gmail ingestion, Google Groups e Vertex passaram a usar o
  helper compartilhado.
- `scripts/generate-env-from-vault.sh` passou a normalizar `*_PRIVATE_KEY`
  antes de escrever `.env`, evitando gerar PEM com barra residual no fim das
  linhas.

Evidencia operacional:

- Pos-deploy de `10d09ca4825c` mostrou `ERR_OSSL_UNSUPPORTED` no job Gmail
  porque `GOOGLE_DRIVE_PRIVATE_KEY` chegava duplamente escapada.

Testes focados executados:

- `npm test -w apps/api -- src/shared/utils/__tests__/google-private-key.test.ts`
- `bash -n scripts/generate-env-from-vault.sh`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Recalculo De `aiExtractedData` Em Delete/Reprocessamento

Correcoes aplicadas:

- Criado `documentService.rebuildProcessAiExtractedData`, que reconstrói
  `import_processes.ai_extracted_data` a partir dos documentos processados
  atuais do processo.
- `reprocess` agora arquiva/zera a extração do documento e reconstrói a
  projeção consolidada dentro da mesma transação antes da nova extração.
- `delete` agora remove a linha do documento e reconstrói a projeção consolidada
  dentro da mesma transação.
- A reconstrução preserva chaves não documentais, escolhe o documento processado
  mais recente por tipo e descarta extrações pendentes, `skipped` ou falhas.

Testes focados executados:

- `npm test -w apps/api -- src/modules/documents/__tests__/service.test.ts src/modules/documents/__tests__/extraction-history.test.ts`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Validacao Documental, Datas Logisticas E Fixtures

Correcoes aplicadas:

- `incoterm-check` passou a extrair o codigo base Incoterms 2020 e aceitar
  variantes comerciais comuns de FOB, como `FOB NINGBO` e `FOB - CHINA`.
- `currency-check` passou a normalizar variantes comuns de USD, incluindo
  `US$`, `U.S.D.`, `USD DOLLARS` e `United States Dollars`.
- `dates-match` passou a comparar apenas campos logisticos de embarque/ETD e
  deixou de usar `invoiceDate` como fallback para shipment.
- Adicionada fixture representativa INV/PL/OHBL/FUP que roda `allChecks` real,
  sem mock, e falha se um conjunto documental coerente produzir `failed`.

Testes focados executados:

- `npm test -w apps/api -- src/modules/validation/checks/__tests__/dates-match.test.ts src/modules/validation/checks/__tests__/incoterm-currency.test.ts src/modules/validation/checks/__tests__/document-fixture.test.ts`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

Pendencia mantida:

- Trocar/complementar a fixture representativa por PDFs ou extracoes reais
  anonimizadas quando o negocio liberar amostras.
- Pos-deploy de `e72e8930ce91` confirmou API/cert-api healthy, mas logs antigos
  ainda avisavam `KIOM_EMAIL`, `FENICIA_EMAIL` e `ISA_EMAIL` ausentes em
  producao. A pendencia foi movida para cadastro via Configuracoes, pois depende
  dos enderecos reais do negocio.

## 2026-06-17 - Hardening Cert-API, Fenicia, AuthZ E Dependencias

Analise continuada com subagentes para cert-api/proxy, AuthZ/Fenicia e
dependencias npm.

Correcoes aplicadas:

- `cert-api` passou a falhar fechado quando `CERT_API_KEY` esta ausente; apenas
  `/api/health` e `/api/ready` ficam sem API key.
- Nginx do `web` passou a injetar `X-API-Key` no proxy `/cert-api/` via
  `CERT_API_KEY`; compose de producao exige a variavel para `web` e `cert-api`.
- Proxy dev do Vite tambem injeta `X-API-Key` quando `CERT_API_KEY` existe no
  ambiente local.
- API Node inicializa Redis/cache fora de testes e encerra Redis no shutdown.
- Cadastro de usuarios no frontend ficou restrito aos papeis `admin` e
  `analyst`.
- Rotas criticas passaram a exigir admin: delete de processo, reprocess/delete
  de documento, sync manual de follow-up, delete de item de espelho e envio/marco
  Fenícia.
- "Enviar para Fenícia" agora cria comunicacao, envia SMTP real por
  `communicationService.send` e so marca espelho/processo apos sucesso.
- Dependencias com audit `high` foram removidas: `vite`, `form-data`,
  `@grpc/grpc-js` e `multer` ficaram em versoes corrigidas.

Observacoes:

- `npm audit --audit-level=high` ficou sem `high`/`critical`; restam 13
  moderadas e 1 baixa transitivas registradas em `docs/TECH_DEBT.md`.
- `@googleapis/drive` foi atualizado para major. `testcontainers` v12 foi
  testado, mas voltou para 11.14.0 porque puxou `undici@8` e quebrou E2E local
  com Node 20.

## 2026-06-17 - Revisao Completa Pos-Deploy, Segurança E Operacao

Analise conduzida com subagentes especializados em backend/RAG/seguranca,
frontend/UX e DevOps/producao.

Correcoes aplicadas:

- Assistente operacional nao usa mais fontes com score zero; pergunta sem
  evidencia positiva retorna resposta deterministica sem fontes e sem chamada IA.
- Auditoria no assistente com `processId` filtra `entityType = process`.
- Comunicacoes validam allowlist de destinatarios antes do envio SMTP.
- Envio registra `userId` real em auditoria/evento e assinatura e validada pelo
  usuario autenticado.
- Ingestao de e-mail usa mailbox normalizado para allowlist e Vimbar, evitando
  substring no header `From`.
- Pre-Cons recebido por e-mail passa por limite de tamanho, tipo suportado e
  magic bytes antes do parser XLSX.
- Query booleana de ingestao corrige `includeRead=false` e `allSenders=false`.
- Logs de e-mail aceitam filtro backend por `processId`/`processCode`; detalhe
  do processo deixou de filtrar apenas os 50 recentes no frontend.
- Busca manual de e-mails no detalhe de documentos fica restrita visualmente a
  admins, alinhada ao backend.
- Exportacao CSV de alertas/atendimentos busca todas as paginas dos filtros
  ativos.
- Editor de e-mail de correcao salva/envia o corpo atual mesmo sem blur.
- Deploy aborta em falha de migration antes de subir api/web novos.
- Backup inclui volume `cert-certs` e arquiva volumes persistentes via Docker
  mount, sem depender de permissao direta em `/var/lib/docker/volumes`.
- Healthchecks de Docker passam a usar readiness real de API e cert-api.
- Deploy recria `cert-api` junto com API/Web e valida readiness do servico.
- API libera `/metrics` para rede privada Docker apenas com flag explicita.
- Restore testado em producao em 2026-06-17 usando
  `importacao_2026-06-17_203311.pgdump`: 30 tabelas e 273 processos restaurados
  em banco temporario, com cleanup concluido.
- SOPS + age configurado em producao: chave privada somente no servidor, chave
  publica em `.sops.yaml`, `.env.sops.yaml` criptografado e versionado.
- Restore test semanal agendado no crontab do servidor aos domingos 03:20, com
  log em `/home/nicolas/importacao/logs/restore-test.log`.

Testes executados:

- `npm run typecheck`
- `npm run lint`
- `npm test` (API 514 passed / 1 skipped; Web 30 passed)
- `npm test -w apps/web`
- `npm run build`
- `docker compose -f docker-compose.prod.yml config --quiet`

Observacoes:

- Build web manteve o warning conhecido de CSS `@import`.
- `docker compose config` local avisou `ERP_MSSQL_USER`/`ERP_MSSQL_PASS`
  ausentes porque o `.env` de producao nao estava carregado.

## 2026-06-17 - Harness Validacao, FOB, Portos E Deploy

Alteracoes entregues no commit `997aac4`:

- Checklist de validacao separa falhas abertas, atencoes abertas, aceitos e conformes.
- Aceite manual deixa de contar como falha aberta.
- Botoes de email de correcao aparecem apenas quando ha falha aberta.
- Revalidacao invalida checklist, relatorio, comparativo, processo, eventos e comunicacoes.
- FOB passou a classificar item comercial, FOC/amostra/brinde e ajuste/desconto.
- Desconto negativo e FOC com valor positivo sao tratados como divergencia explicada quando reconciliam o FOB declarado.
- Portos normalizam acento, pais por sigla/nome, parenteses e barra.
- Prefix match inseguro em portos foi removido.
- Falta total de porto de descarga vira `warning`.
- Anomalia deterministica nao soma FOC/desconto como item comercial.

Testes executados:

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`

Deploy:

- SHA `997aac4` publicado em `192.168.168.124`.
- Backup pre-deploy: `/home/nicolas/backups/importacao/importacao_2026-06-17_110416.pgdump`.
- Pos-deploy: `importacao-api` e `importacao-web` healthy; `/health/ready` OK.

Pendencias identificadas:

- Ver `docs/KNOWN_ISSUES.md` e `docs/TECH_DEBT.md`.

## 2026-06-17 - Memoria E Governanca Do Harness

Criados arquivos para operacionalizar o prompt mestre:

- `AGENTS.md`
- `docs/HARNESS_PROMPT.md`
- `docs/PROJECT_MEMORY.md`
- `docs/SESSION_MEMORY.md`
- `docs/KNOWN_ISSUES.md`
- `docs/TECH_DEBT.md`
- `docs/ARCHITECTURE.md`
- `docs/BUSINESS_RULES.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/SECURITY.md`
- `docs/DEPLOY.md`
- `docs/OBSERVABILITY.md`
- `docs/PERFORMANCE.md`
- `docs/ROADMAP.md`
- `docs/ADR/README.md`

Observacao:

- `docs/adr/` continua sendo o diretorio canonico de ADRs ja existentes.

## 2026-06-17 - Revisao UX/UI, Dados E Seguranca

Analise conduzida com tres subagentes especializados:

- UX/UI, rotas, navegacao e botoes.
- Duplicidade de fetch/cache e informacao exibida.
- Dominio de importacao, leitura de documentos, invoice/espelho/BL, validacoes e e-mails.

Correcoes aplicadas:

- Removida busca global falsa dos sidebars.
- Incluido `Meu Dia` no menu e no titulo do layout.
- Corrigido titulo global de edicao de processo.
- Adicionados alvos `#main` para skip link em Login, Portal e Certificacoes.
- Melhorada acessibilidade de menu, logout, abas, filtros de data, lista de documentos e lista de processos.
- E-mails e cambios do detalhe de processo reutilizam dados ja carregados quando possivel.
- Removido bloco duplicado de dados extraidos no card de Informacoes do Processo.
- Fechado vetor critico de anexo por `path` livre em comunicacoes.
- Ingestao manual de e-mail passou a exigir admin para trigger, varredura historica e reprocessamento.
- Anexo de e-mail passa a respeitar limite maximo de 50 MB ou `EMAIL_ATTACHMENT_MAX_BYTES`.

Documento de auditoria:

- `docs/UX_UI_AUDIT_2026-06-17.md`

Testes executados:

- `npm run -w apps/web typecheck`
- `npm test -w apps/web`
- `npm run -w apps/api typecheck`
- `npm test -w apps/api`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Observacao:

- `npm test -w apps/api -- --runInBand` nao e suportado pelo Vitest atual; a suite padrao passou.

## 2026-06-17 - Assistente RAG, Relatorios CSV E Nomenclatura

Alteracoes aplicadas:

- Criado modulo `apps/api/src/modules/assistant` com rota autenticada `POST /api/assistant/query`.
- Assistente recupera fontes internas de processos, alertas, atendimentos/e-mails, e-mails recebidos, validacoes, documentos, follow-up, eventos, auditoria para admin e base RAG existente.
- `aiService.generateOperationalAssistantAnswer` usa as fontes recuperadas para resposta em PT-BR e cai para resumo deterministico quando a IA falha.
- Criada pagina `/importacao/assistente` com pergunta, filtro opcional por processo, atalhos e fontes clicaveis.
- Menu de Importacao padronizado para `Assistente`, `Atendimentos` e `Central de Alertas`.
- Alertas e atendimentos ganharam exportacao CSV baseada nos filtros atuais.
- Nomenclatura revisada em paginas centrais: alertas, atendimentos, auditoria, detalhe de processo, e-mails, cambios, LIs, dashboard, follow-up, validacao e documentos.

Verificacoes ja executadas nesta sessao:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run lint` final apos ajustes de teste/texto

Pendencias antes de deploy:

- Commit, push e `scripts/deploy.sh`.

## 2026-06-18 - Auditoria Feedback Eduarda/Leticia E Invoice DEMO 264

Contexto:

- Feedback operacional revisado contra codigo, documentacao e producao.
- Producao consultada no processo `264` (`DEMO-IM0712602NB-E227210`).

Evidencias de producao:

- Documento `2026.02.22 KIOM INV - IM0712602NB (1).pdf` estava como
  `type=invoice` e `is_processed=true`, mas sem `exporterName`, sem
  `invoiceNumber`, sem datas logisticas e com `items=0`.
- Packing List, OHBL, Draft BL e Espelho tinham dados parciais/itens; a falha
  principal do Comparativo era a invoice antiga sem dado util, nao ausencia de
  aba ou botao.
- SKU `050402313` em producao: `last_validation_status=URL_NOT_FOUND`,
  `is_expired=true`, `sale_deadline=07/12/2025`; a derivacao atual retorna
  `cert_status=ENCERRADO`, `site_status=CONFORME`,
  `license_status=NAO_APLICAVEL`, `comercializacao_status=ENCERRADA`.

Correcoes aplicadas nesta sessao:

- Documento processado sem dado util extraido deixou de contar como lido.
- `aiParsedData` vazio, com campos `{ value: null }`, string vazia ou lista de
  itens vazia nao projeta dados em `aiExtractedData`.
- Comparativo, validacao e deteccao de anomalias passaram a ignorar documentos
  sem dado util, mesmo que estejam `isProcessed=true`.
- Nova extracao IA que retorna sucesso sem dado util passa a ser marcada como
  `extractionFailed`, com alerta critico para reprocessar/reclassificar.

Status dos pedidos:

- Importacao: FOC/desconto, centralizacao no Comparativo, filtros,
  `Aceitar`, comparativo por item, normalizacao de portos, ETD com tolerancia,
  log de checklist e Proformas estao implementados. A invoice do processo 264
  ainda depende de reprocessamento/reupload apos deploy desta correcao.
- Importacao pendente de decisao UX: unificar `Atendimentos` e `E-mails`.
- Certificacao: tela principal ja mostra `Status Certificacao`,
  `Cert. - Prazo`, `Status Ecommerce`, `Status Licenciamento` e
  `Licen. - Prazo`; exportacoes/relatorios ainda tem nomenclatura legada
  `Status`/`Prazo Venda`.
- Certificacao pendente de dado/regra: prazo de licenciamento separado nao
  existe na fonte atual; estoque CD usa disponivel do WMS, nao necessariamente
  estoque fisico do relatorio externo da Leticia.

Testes locais executados:

- `npm test -w apps/api -- src/modules/documents/__tests__/service.test.ts`
- `npm test -w apps/api -- src/modules/documents/__tests__/process-with-ai-resilience.test.ts`
- `npm test -w apps/api -- src/modules/validation/__tests__/service.test.ts`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `npm test`
- `npm run build`
