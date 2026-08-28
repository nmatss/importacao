-- Explicit document intake lineage for the Drive-only operational contract.
-- Idempotent and forward-only; existing rows remain `legacy` and continue to
-- use the relational email-lineage fallback in the application.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_ingestion_source') THEN
    CREATE TYPE "document_ingestion_source" AS ENUM ('legacy', 'manual', 'drive', 'email');
  END IF;
END $$;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "ingestion_source" "document_ingestion_source"
  NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS "documents_ingestion_source_idx"
  ON "documents" ("ingestion_source");
