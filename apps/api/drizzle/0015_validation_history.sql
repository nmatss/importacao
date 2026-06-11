-- Historization of validations and extractions (regulatory audit — backlog #12).
-- validation_result_history: append-only snapshot of validation_results taken
--   right before each delete+recreate run (validation/service.ts runAllChecks).
-- document_extraction_history: snapshot of documents.ai_parsed_data taken before
--   it is zeroed (reprocess) or overwritten (re-extraction).
-- Pure ADD + idempotent (IF NOT EXISTS) — safe to apply via apply-pending-migrations.sh.

CREATE TABLE IF NOT EXISTS "validation_result_history" (
  "id" serial PRIMARY KEY,
  "process_id" integer NOT NULL REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "run_at" timestamptz NOT NULL DEFAULT now(),
  "check_name" varchar(100) NOT NULL,
  "status" varchar(20) NOT NULL,
  "message" text,
  "details" jsonb,
  "resolved_manually" boolean DEFAULT false,
  "resolution_note" text,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "validation_result_history_process_id_idx"
  ON "validation_result_history" ("process_id");
CREATE INDEX IF NOT EXISTS "validation_result_history_process_run_idx"
  ON "validation_result_history" ("process_id", "run_at");

CREATE TABLE IF NOT EXISTS "document_extraction_history" (
  "id" serial PRIMARY KEY,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "ai_parsed_data" jsonb,
  "confidence" numeric(5, 4),
  "archived_at" timestamptz NOT NULL DEFAULT now(),
  "reason" text NOT NULL DEFAULT 'reprocess'
);

CREATE INDEX IF NOT EXISTS "document_extraction_history_document_id_idx"
  ON "document_extraction_history" ("document_id");
