# Session Memory

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
- Backup inclui volume `cert-certs`.
- Healthchecks de Docker passam a usar readiness real de API e cert-api.
- API libera `/metrics` para rede privada Docker apenas com flag explicita.

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
