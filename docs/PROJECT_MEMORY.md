# Project Memory - Importacao

Ultima atualizacao: 2026-06-19

## Objetivo

Sistema de gestao de importacoes do Grupo Uni.co para Puket e Imaginarium,
incluindo processos de importacao, documentos, validacoes, espelhos, follow-up,
comunicacoes, assistente operacional RAG, certificacoes, dashboards
operacionais e relatorio SYDLE de compras/pagamentos internacionais.

Evidencias:

- `README.md` descreve o sistema e os modulos.
- `docs/STATUS-2026-06-16.md` consolida estado recente, deploys e decisoes.
- `docs/REVISAO-IMPORTACAO-WORKFLOW-2026-06-17.md` define o fluxo operacional de importacao.

Grau de confianca: alto.

## Arquitetura Atual

Monorepo npm workspaces com:

- `apps/api`: Node.js, Express, TypeScript, Drizzle ORM, PostgreSQL, Redis, pg-boss.
- `apps/web`: React 18, Vite, Tailwind CSS.
- `apps/cert-api`: Python FastAPI para certificacoes, VTEX, ERP/WMS e relatorios.
- `docker-compose.yml` e `docker-compose.prod.yml`: orquestracao dev/prod.
- `scripts/deploy.sh`: deploy de producao com backup, snapshot de rollback, rsync, rebuild e health check.

Evidencias:

- `README.md`
- `docker-compose.prod.yml`
- `.github/workflows/ci.yml`
- `scripts/deploy.sh`

Grau de confianca: alto.

## Dominio De Negocio

Fluxo central:

1. Processo nasce manualmente, por Pre-Cons ou email.
2. Documentos entram por upload ou email ingestion.
3. Sistema classifica e extrai invoice, proforma, packing list, BL, draft BL, espelho, LI e certificados.
4. Dados alimentam card do processo, validacoes, comparativo e espelho.
5. Operador corrige, aceita divergencia com justificativa ou reprocessa.
6. Follow-up, milestones, alertas, comunicacoes e auditoria registram o ciclo.
7. Assistente operacional RAG responde perguntas sobre processos, atendimentos,
   alertas, documentos e validacoes usando fontes internas recuperadas.

Evidencias:

- `docs/REVISAO-IMPORTACAO-WORKFLOW-2026-06-17.md`
- `apps/api/src/modules/documents/service.ts`
- `apps/api/src/modules/validation/service.ts`
- `apps/web/src/features/processes/ProcessDetailPage.tsx`

Grau de confianca: alto.

## Regras De Negocio Importantes

- Invoice tem prioridade sobre espelho para campos equivalentes no card do processo.
- Espelho pode preencher campos antes da invoice; fonte visual amarela para espelho, verde para invoice.
- Validacao possui status `passed`, `failed`, `warning`, `skipped`.
- Validacao parcial e diagnostica: pode gerar evidencias e alerta operacional,
  mas nao deve promover processo, abrir correcao final, mover pasta ou gerar
  comunicacao KIOM.
- Validacao final exige o check sistemico `document-set-completeness` aprovado:
  Invoice, Packing List e OHBL/Draft BL utilizaveis.
- Cada validacao final deve registrar uma linha canonica em `validation_runs` e
  vincular resultados atuais/historicos/correcoes ao `validation_run_id` na
  mesma transacao de persistencia.
- Aceite manual exige justificativa e nao altera o dado original.
- FOC/desconto nao deve reabrir falso positivo de FOB quando identificado.
- Portos precisam ser normalizados para pais/sufixo, mas sem aceitar prefixo inseguro.
- Documentos ausentes devem gerar `skipped` ou `warning`, nao falsa conformidade.
- Documentos com falha de extracao, sem dados uteis ou abaixo da confianca
  operacional minima nao devem alimentar `aiExtractedData`, comparativo,
  validacao ou indicadores verdes de documento extraido.
- O marco `documents_received` aceita Invoice + Packing List + OHBL ou Draft BL.
- Historico de extracao deve ser consultavel por processo para manter auditoria
  mesmo apos delete do documento original.
- Falha de contrato Zod da IA deve ser preservada em `_trust.contractFailure` e
  derrubar a confianca abaixo do piso operacional, mantendo evidencia para
  revisao humana sem alimentar validacao automatica.
- Comunicacoes nunca devem aceitar anexo por `path` livre do cliente; anexo precisa ser resolvido por documento/espelho autorizado do mesmo processo.
- Trigger, varredura historica e reprocessamento manual de e-mail ingestion sao operacoes administrativas.
- Exportacoes CSV de alertas e atendimentos devem refletir os filtros atuais da tela, evitando relatorios duplicados com o mesmo dado.
- Assistente operacional deve responder somente com fontes internas; se a IA falhar, o fallback deterministico deve explicar as evidencias encontradas.

Evidencias:

- `apps/web/src/features/processes/components/ProcessInfoCard.tsx`
- `apps/web/src/features/validation/ValidationChecklist.tsx`
- `apps/api/src/modules/validation/checks/fob-calculation.ts`
- `apps/api/src/modules/validation/utils/port-normalize.ts`

Grau de confianca: alto.

## Dados E Banco

Fonte principal:

- `apps/api/src/shared/database/schema.ts`
- migrations `apps/api/drizzle/0000` ate `0018`

Tabelas centrais observadas:

- `users`
- `import_processes`
- `documents`
- `process_items`
- `validation_results`
- `validation_runs`
- `validation_result_history`
- `document_extraction_history`
- `follow_up_tracking`
- `communications`
- `alerts`
- `process_events`
- `email_ingestion_logs`
- `settings`
- `ai_usage_log`
- `sydle_purchase_payments`
- `sydle_sync_runs`

Grau de confianca: medio-alto. A lista deve ser revisada contra todo `schema.ts`
quando houver mudanca de dados.

## Integracao SYDLE

Estado:

- Modulo tecnico entregue em 2026-06-18.
- Sync automatico agendado a cada 15 minutos.
- Rotas `/api/sydle/*` e tela `/importacao/compras-pagamentos` restritas a
  administradores.
- A tela tambem aparece no menu `Importacao > Operacional >
Compras/Pagamentos SYDLE` e no atalho `Pagamentos SYDLE` do portal para
  administradores.
- A UI do relatorio deve expor os campos financeiros relevantes recebidos da
  SYDLE: cambio, valor BRL, banco, contrato, remessa, datas de
  pagamento/agendamento, motivo de conciliacao e timestamps SYDLE/Portal.
- Cursor incremental usa maior `sourceUpdatedAt`/`updatedAt` da fonte com
  overlap de 5 minutos e parser de data/hora PT-BR; nao usa horario local de
  inicio como cursor.
- Matching financeiro nao deve conciliar automaticamente com invoice/PI/pedido
  isolado; exige processo exato, compra forte ou evidencias combinadas.
- `raw_payload` e sanitizado antes de persistir chaves sensiveis comuns.
- Em 2026-06-19, a fonte real Sydle One foi validada via
  `SYDLE_SOURCE_TYPE=sydle_one_class`: login `sys/auth/signIn`, cookie de
  sessao e `POST /api/1/main/_classId/68bf1179b042c72f03993928/_search`.
- A classe `68bf1179b042c72f03993928` (`Solicitacao de Pagamento
Internacional/current`) retornou 14 solicitacoes e `paymentData[]`; o portal
  achata cada parcela em linha financeira com `externalId`
  `sydle-one:{requestId}:{paymentId}`.
- O usuario/API atual consegue resolver ticket, status e moeda; formularios
  `InternationalPaymentOpenForm` e `RequestData` retornaram 403, entao
  fornecedor/PI/invoice dependem de permissao adicional ou visao SYDLE.
- `scripts/deploy.sh` bloqueia deploy se `SYDLE_SYNC_ENABLED=true`, salvo
  rollout financeiro aprovado com `ALLOW_SYDLE_SYNC_DEPLOY=1`.
- Sync real usa SOPS/env com `SYDLE_SYNC_ENABLED=true`,
  `SYDLE_SOURCE_TYPE=sydle_one_class`, `SYDLE_BASE_URL`, `SYDLE_USER`,
  `SYDLE_PASSWORD`, `SYDLE_CLASS_ID` e `SYDLE_DATE_FIELD`.

## Integracao Google Drive

Estado:

- Credenciais Google podem estar configuradas para Pre-Cons/Sheets mesmo quando
  a pasta raiz operacional nao esta.
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` vazio ou `your-root-folder-id` deve ser tratado
  como Drive operacional desconfigurado; upload, movimentacao e relatorios no
  Drive devem degradar sem afetar extração, comparativo ou validacao.
- Para reativar a arvore operacional, preencher o folder ID real no SOPS/env e
  compartilhar a pasta com a service account.

Evidencias:

- `docs/SYDLE-INTEGRATION.md`
- `apps/api/src/modules/sydle`
- `apps/web/src/features/sydle-payments/SydlePaymentsPage.tsx`

Grau de confianca: alto para a arquitetura interna e para a classe Sydle One
validada; medio para campos complementares de formulario, pois a API atual
retornou 403 para essas referencias.

## IA E Harness

Estado atual de producao recente:

- `AI_PROVIDER=ialocal` por padrao.
- `AI_ALLOW_EXTERNAL=false` por padrao.
- `AI_USE_SPECIALIST=1` por padrao em compose/env schema.
- Skills e harness vivem em `apps/api/src/modules/ai/skills` e `apps/api/src/modules/ai/harness`.
- RAG operacional usa `apps/api/src/modules/assistant/service.ts` com recuperacao lexical sobre tabelas internas e base `apps/api/src/modules/ai/knowledge`.
- Ha documentacao historica que recomenda Vertex para qualidade/privacidade, mas o status mais recente registra IA local em producao e Vertex como decisao pendente.

Evidencias:

- `docker-compose.prod.yml`
- `apps/api/src/shared/config/env.ts`
- `docs/STATUS-2026-06-16.md`
- `docs/AI-HARNESS.md`
- `docs/IA-ESPECIALISTA.md`

Grau de confianca: alto para estado de codigo; medio para estrategia futura, pois depende de decisao humana.

## Infraestrutura E Deploy

- Producao conhecida: `192.168.168.124`.
- Deploy atual por `scripts/deploy.sh`.
- O script faz backup PostgreSQL, snapshot de rollback, rsync, rebuild de `api` e `web`, migrations pendentes e health check.
- Banco e Redis expostos apenas localmente/internamente conforme compose prod.
- SHA `3f36137a697fee9f4f1011bc3eace3417467d5be` foi implantado com sucesso
  operacional em 2026-06-19: backup, migrations, API/web/cert-api healthy,
  observabilidade iniciada e `REVISION` remoto gravado.
- O go-live publico ainda esta bloqueado: `https://importacao.grupounico.com/`
  retornou 502 de uma camada `nginx` externa. A topologia correta confirmada e
  Nginx/edge externo -> Nginx interno do app em `192.168.168.124:8085`; manter
  o compose com `8085:80` e sem roteamento Traefik para este dominio.

Evidencias:

- `scripts/deploy.sh`
- `docker-compose.prod.yml`
- `docs/STATUS-2026-06-16.md`

Grau de confianca: alto.

## Riscos Persistentes

Ver detalhes em:

- `docs/KNOWN_ISSUES.md`
- `docs/TECH_DEBT.md`
- `docs/ROADMAP.md`
- `docs/STATUS-2026-06-16.md`
- `docs/UX_UI_AUDIT_2026-06-17.md`

Principais temas:

- Extração de cabeçalho/portos/datas ainda depende da qualidade do provider.
- Odoo agora aceita URL/database/usuario do banco com fallback para env; senha
  permanece em SOPS/env.
- Fluxos de aceite entre checklist e comparativo ainda podem ser melhor unificados.
- Documentacao de IA possui divergencias historicas entre Vertex ideal e IA local atual.
