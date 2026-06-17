# Project Memory - Importacao

Ultima atualizacao: 2026-06-17

## Objetivo

Sistema de gestao de importacoes do Grupo Uni.co para Puket e Imaginarium,
incluindo processos de importacao, documentos, validacoes, espelhos, follow-up,
comunicacoes, assistente operacional RAG, certificacoes e dashboards operacionais.

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
- Aceite manual exige justificativa e nao altera o dado original.
- FOC/desconto nao deve reabrir falso positivo de FOB quando identificado.
- Portos precisam ser normalizados para pais/sufixo, mas sem aceitar prefixo inseguro.
- Documentos ausentes devem gerar `skipped` ou `warning`, nao falsa conformidade.
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
- migrations `apps/api/drizzle/0000` ate `0015`

Tabelas centrais observadas:

- `users`
- `import_processes`
- `documents`
- `process_items`
- `validation_results`
- `validation_result_history`
- `document_extraction_history`
- `follow_up_tracking`
- `communications`
- `alerts`
- `process_events`
- `email_ingestion_logs`
- `settings`
- `ai_usage_log`

Grau de confianca: medio-alto. A lista deve ser revisada contra todo `schema.ts`
quando houver mudanca de dados.

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
