# Database

Ultima atualizacao: 2026-06-19

## Fonte Canonica

- Schema Drizzle: `apps/api/src/shared/database/schema.ts`
- Migrations SQL: `apps/api/drizzle/`
- Runner: `apps/api/src/shared/database/migrate.ts`
- Deploy aplica migrations pendentes via `scripts/apply-pending-migrations.sh`.

## Enums Principais

- `user_role`: `admin`, `analyst`
- `process_status`: `draft`, `documents_received`, `validating`, `validated`,
  `espelho_generated`, `sent_to_fenicia`, `li_pending`, `completed`, `cancelled`
- `brand`: `puket`, `imaginarium`
- `document_type`: `invoice`, `proforma_invoice`, `packing_list`, `ohbl`,
  `draft_bl`, `espelho`, `li`, `certificate`, `other`
- `validation_status`: `passed`, `failed`, `warning`, `skipped`

## Tabelas Centrais

- `users`
- `import_processes`
- `documents`
- `process_items`
- `validation_runs`
- `validation_results`
- `validation_result_history`
- `document_extraction_history`
- `follow_up_tracking`
- `communications`
- `alerts`
- `settings`
- `ai_usage_log`
- `pre_cons_items`
- `pre_cons_sync_log`
- `sydle_purchase_payments`
- `sydle_sync_runs`

## Migrations Fora Do Journal Drizzle

- `0011_proforma_invoice.sql` ate `0018_validation_run_links.sql` sao SQL
  idempotentes aplicados pelo fluxo pendente (`scripts/apply-pending-migrations.sh`)
  e pelo setup E2E apos `migrate()`.
- `0016_pre_cons_tables.sql` cria `pre_cons_items` e `pre_cons_sync_log`,
  alinhadas ao `schema.ts`, com indices em `process_code`, `item_code` e
  `pi_number`. Nao ha FK fisica declarada no schema atual para essas tabelas.
- `0017_sydle_purchase_payments.sql` cria `sydle_purchase_payments` e
  `sydle_sync_runs` para staging/auditoria da integracao SYDLE de compras e
  pagamentos internacionais.
- `0018_validation_run_links.sql` adiciona `validation_run_id` em resultados
  atuais/historicos de validacao e altera `document_extraction_history` para
  preservar historico mesmo apos delete do documento.
- `0021_sydle_report_columns.sql` adiciona, de forma idempotente, colunas de
  paridade com o relatório SYDLE Analytics/CSV em `sydle_purchase_payments`
  (`sydle_protocol`, datas de invoice/tarefa/embarque, exceção e prazo
  pós-embarque).

## Indices Observados

Exemplos no schema:

- `import_processes_status_idx`
- `import_processes_brand_idx`
- `import_processes_status_brand_idx`
- `import_processes_status_updated_idx`
- `documents_process_id_idx`
- `documents_process_type_idx`
- `process_items_process_id_idx`

## Cuidados Operacionais

- Antes de migration: backup obrigatorio em producao via deploy script.
- Evitar migration destrutiva sem plano de reversao.
- Historico de validacao e extracao existe para auditoria regulatoria.
  `validation_runs` e a entidade canonica de execucao; delete de documento deve
  arquivar extracao antes da remocao e a recuperacao operacional tambem pode
  ocorrer por `process_id` quando `document_id` foi anulado por delete.
- Validacoes `partial` mantem `validation_results` como projecao exclusiva da
  ultima validacao final e gravam seus checks append-only em
  `validation_result_history`, vinculados ao `validation_run_id`.
- `document_extraction_runs.extraction_status` registra tambem `failed`,
  `skipped` e `deterministic`; atualizacao terminal do documento e criacao do
  run sao uma unica transacao.
- `process_items` e uma projecao operacional editavel e opcional. A fonte
  canonica dos itens extraidos continua no documento vigente e em sua linhagem,
  conforme ADR 0006.
- Alteracoes em enums precisam de migration idempotente e atencao a deploy.

## Pendencias

- Mapear todas as tabelas de `schema.ts` em diagrama ER.
- Auditar queries mais frequentes para indice/filtro.
- Documentar cardinalidade e politicas de retencao.
