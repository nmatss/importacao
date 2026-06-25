-- Enterprise audit hardening for document extraction and email attachments.
-- Idempotent for deploy/apply-pending-migrations re-runs.

CREATE TABLE IF NOT EXISTS "email_attachment_documents" (
  "id" serial PRIMARY KEY,
  "email_log_id" integer REFERENCES "email_ingestion_logs"("id") ON DELETE CASCADE,
  "document_id" integer REFERENCES "documents"("id") ON DELETE SET NULL,
  "process_id" integer REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "process_code" varchar(50),
  "message_id" varchar(500) NOT NULL,
  "transport_id" varchar(255),
  "attachment_index" integer NOT NULL,
  "filename" varchar(500) NOT NULL,
  "content_sha256" varchar(64) NOT NULL,
  "file_size" integer,
  "storage_path" text,
  "sistema_file_id" varchar(255),
  "document_type" varchar(50),
  "status" varchar(30) DEFAULT 'processed' NOT NULL,
  "orphaned" boolean DEFAULT false NOT NULL,
  "recoverable" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_attachment_documents_email_log_id_idx"
  ON "email_attachment_documents" ("email_log_id");
CREATE INDEX IF NOT EXISTS "email_attachment_documents_document_id_idx"
  ON "email_attachment_documents" ("document_id");
CREATE INDEX IF NOT EXISTS "email_attachment_documents_process_id_idx"
  ON "email_attachment_documents" ("process_id");
CREATE INDEX IF NOT EXISTS "email_attachment_documents_hash_idx"
  ON "email_attachment_documents" ("content_sha256");
CREATE UNIQUE INDEX IF NOT EXISTS "email_attachment_documents_message_attachment_uidx"
  ON "email_attachment_documents" ("message_id", "attachment_index");
CREATE UNIQUE INDEX IF NOT EXISTS "email_attachment_documents_process_hash_uidx"
  ON "email_attachment_documents" ("process_id", "content_sha256");

CREATE TABLE IF NOT EXISTS "comparison_acceptances" (
  "id" serial PRIMARY KEY,
  "process_id" integer NOT NULL REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "validation_run_id" integer REFERENCES "validation_runs"("id") ON DELETE SET NULL,
  "scope" varchar(20) NOT NULL,
  "row_key" varchar(160) NOT NULL,
  "field_label" varchar(160) NOT NULL,
  "item_code" varchar(80),
  "previous_status" varchar(30),
  "evidence_hash" varchar(64) NOT NULL,
  "resolution_note" text NOT NULL,
  "accepted_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "accepted_at" timestamptz DEFAULT now() NOT NULL,
  "invalidated_at" timestamptz,
  "invalidation_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "comparison_acceptances_process_id_idx"
  ON "comparison_acceptances" ("process_id");
CREATE INDEX IF NOT EXISTS "comparison_acceptances_process_row_idx"
  ON "comparison_acceptances" ("process_id", "row_key");
CREATE UNIQUE INDEX IF NOT EXISTS "comparison_acceptances_active_evidence_uidx"
  ON "comparison_acceptances" ("process_id", "scope", "row_key", "evidence_hash");

CREATE TABLE IF NOT EXISTS "document_extraction_runs" (
  "id" serial PRIMARY KEY,
  "document_id" integer REFERENCES "documents"("id") ON DELETE SET NULL,
  "process_id" integer REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "document_type" varchar(50) NOT NULL,
  "provider" varchar(50),
  "model" varchar(100),
  "parser_version" varchar(50) DEFAULT '2026-06-24' NOT NULL,
  "confidence" numeric(5,4),
  "source_text_hash" varchar(64),
  "source_text_length" integer,
  "extraction_status" varchar(30) DEFAULT 'completed' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "document_extraction_runs_document_id_idx"
  ON "document_extraction_runs" ("document_id");
CREATE INDEX IF NOT EXISTS "document_extraction_runs_process_id_idx"
  ON "document_extraction_runs" ("process_id");
CREATE INDEX IF NOT EXISTS "document_extraction_runs_process_created_idx"
  ON "document_extraction_runs" ("process_id", "created_at");

CREATE TABLE IF NOT EXISTS "document_extracted_fields" (
  "id" serial PRIMARY KEY,
  "run_id" integer NOT NULL REFERENCES "document_extraction_runs"("id") ON DELETE CASCADE,
  "document_id" integer REFERENCES "documents"("id") ON DELETE SET NULL,
  "process_id" integer REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "document_type" varchar(50) NOT NULL,
  "field_path" varchar(255) NOT NULL,
  "value_json" jsonb,
  "confidence" numeric(5,4),
  "source_page" integer,
  "source_text_hash" varchar(64),
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "document_extracted_fields_run_id_idx"
  ON "document_extracted_fields" ("run_id");
CREATE INDEX IF NOT EXISTS "document_extracted_fields_document_id_idx"
  ON "document_extracted_fields" ("document_id");
CREATE INDEX IF NOT EXISTS "document_extracted_fields_process_field_idx"
  ON "document_extracted_fields" ("process_id", "field_path");
