# Database

Ultima atualizacao: 2026-06-18

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

## Migrations Fora Do Journal Drizzle

- `0011_proforma_invoice.sql` ate `0016_pre_cons_tables.sql` sao SQL
  idempotentes aplicados pelo fluxo pendente (`scripts/apply-pending-migrations.sh`)
  e pelo setup E2E apos `migrate()`.
- `0016_pre_cons_tables.sql` cria `pre_cons_items` e `pre_cons_sync_log`,
  alinhadas ao `schema.ts`, com indices em `process_code`, `item_code` e
  `pi_number`. Nao ha FK fisica declarada no schema atual para essas tabelas.

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
- Alteracoes em enums precisam de migration idempotente e atencao a deploy.

## Pendencias

- Mapear todas as tabelas de `schema.ts` em diagrama ER.
- Auditar queries mais frequentes para indice/filtro.
- Documentar cardinalidade e politicas de retencao.
