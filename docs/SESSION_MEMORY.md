# Session Memory

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
- Pos-deploy de `e72e8930ce91` confirmou API/cert-api healthy, mas logs de
  startup ainda avisam `KIOM_EMAIL`, `FENICIA_EMAIL` e `ISA_EMAIL` ausentes em
  producao. Pendencia movida para `docs/KNOWN_ISSUES.md`/`docs/ROADMAP.md`
  porque depende dos enderecos reais do negocio.

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
