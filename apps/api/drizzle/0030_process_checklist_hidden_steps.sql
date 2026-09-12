-- Etapa padrao do checklist oculta POR PROCESSO (reuniao 2026-09-11, D7).
--
-- O catalogo de etapas padrao e global; a operacao pediu para esconder uma
-- etapa num processo especifico sem afetar os demais e sem apagar a coluna de
-- data correspondente em `import_processes`. Uma linha aqui = "a etapa
-- `step_key` nao aparece no checklist deste processo". Reexibir e apagar a
-- linha; o dado da etapa nunca e tocado.
--
-- `step_key` e a chave estavel da etapa no catalogo (ex.: `sentToFeniciaAt`),
-- nao o rotulo exibido, que pode mudar.
--
-- Aditiva e idempotente; safe to run from the forward-only production
-- migration runner.

CREATE TABLE IF NOT EXISTS "process_checklist_hidden_steps" (
  "id" serial PRIMARY KEY,
  "process_id" integer NOT NULL
    REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "step_key" text NOT NULL,
  "hidden_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "process_checklist_hidden_steps_process_step_uniq"
    UNIQUE ("process_id", "step_key")
);
