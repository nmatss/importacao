-- Analysis-document hardening: recoverable worker lease and bounded evidence.
-- Idempotent; safe to run from the forward-only production migration runner.

-- Avoid duplicate OCR/AI work when pg-boss redelivers a job or a fallback
-- overlaps a worker. A lease expires so an interrupted worker never blocks a
-- document permanently.
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "extraction_lease_token" varchar(64),
  ADD COLUMN IF NOT EXISTS "extraction_lease_expires_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "documents_extraction_lease_expires_idx"
  ON "documents" ("extraction_lease_expires_at");

-- Bounded source excerpt makes scalar review possible without persisting an
-- additional complete copy of a commercially sensitive document.
ALTER TABLE "document_extracted_fields"
  ADD COLUMN IF NOT EXISTS "source_excerpt" text;
