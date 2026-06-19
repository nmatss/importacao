-- Link live and historical validation results to the canonical validation_runs row.
-- Idempotent and additive: safe for deploy runner and E2E setup re-runs.

ALTER TABLE "validation_results"
  ADD COLUMN IF NOT EXISTS "validation_run_id" integer;

ALTER TABLE "validation_result_history"
  ADD COLUMN IF NOT EXISTS "validation_run_id" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'validation_results_validation_run_id_fk'
  ) THEN
    ALTER TABLE "validation_results"
      ADD CONSTRAINT "validation_results_validation_run_id_fk"
      FOREIGN KEY ("validation_run_id")
      REFERENCES "validation_runs"("id")
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'validation_result_history_validation_run_id_fk'
  ) THEN
    ALTER TABLE "validation_result_history"
      ADD CONSTRAINT "validation_result_history_validation_run_id_fk"
      FOREIGN KEY ("validation_run_id")
      REFERENCES "validation_runs"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "validation_results_run_id_idx"
  ON "validation_results" ("validation_run_id");

CREATE INDEX IF NOT EXISTS "validation_result_history_run_id_idx"
  ON "validation_result_history" ("validation_run_id");

-- Preserve extraction history after document delete. Older history rows keep
-- document_id; new delete snapshots retain process/type/file metadata even
-- after the documents row is removed.
ALTER TABLE "document_extraction_history"
  ADD COLUMN IF NOT EXISTS "process_id" integer,
  ADD COLUMN IF NOT EXISTS "document_type" varchar(50),
  ADD COLUMN IF NOT EXISTS "original_filename" varchar(255),
  ADD COLUMN IF NOT EXISTS "storage_path" text;

UPDATE "document_extraction_history" h
SET
  "process_id" = d."process_id",
  "document_type" = d."type",
  "original_filename" = d."original_filename",
  "storage_path" = d."storage_path"
FROM "documents" d
WHERE h."document_id" = d."id"
  AND h."process_id" IS NULL;

ALTER TABLE "document_extraction_history"
  DROP CONSTRAINT IF EXISTS "document_extraction_history_document_id_documents_id_fk";

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'document_extraction_history'::regclass
      AND c.contype = 'f'
      AND a.attname = 'document_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE "document_extraction_history" DROP CONSTRAINT IF EXISTS %I',
      constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE "document_extraction_history"
  ALTER COLUMN "document_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'document_extraction_history_document_id_fk'
  ) THEN
    ALTER TABLE "document_extraction_history"
      ADD CONSTRAINT "document_extraction_history_document_id_fk"
      FOREIGN KEY ("document_id")
      REFERENCES "documents"("id")
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'document_extraction_history_process_id_fk'
  ) THEN
    ALTER TABLE "document_extraction_history"
      ADD CONSTRAINT "document_extraction_history_process_id_fk"
      FOREIGN KEY ("process_id")
      REFERENCES "import_processes"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "document_extraction_history_process_id_idx"
  ON "document_extraction_history" ("process_id");
