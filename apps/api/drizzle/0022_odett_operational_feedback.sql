-- Feedback operacional Odett 2026-07-09.
-- Idempotent changes for email review, urgent process note, DUIMP docs and
-- customs registration fields.
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction. Apply through
-- scripts/apply-pending-migrations.sh or apps/api/src/shared/database/migrate.ts,
-- both of which execute pending SQL directly via psql/pool.unsafe.

ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'draft_duimp';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'duimp';

ALTER TABLE "email_ingestion_logs"
  ADD COLUMN IF NOT EXISTS "body_text" text;

ALTER TABLE "import_processes"
  ADD COLUMN IF NOT EXISTS "urgent_note" text,
  ADD COLUMN IF NOT EXISTS "customs_value" numeric(14, 2),
  ADD COLUMN IF NOT EXISTS "registration_dollar" numeric(10, 6),
  ADD COLUMN IF NOT EXISTS "duimp_number" varchar(100),
  ADD COLUMN IF NOT EXISTS "registered_at" timestamp;

CREATE TABLE IF NOT EXISTS "communication_templates" (
  "id" serial PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "recipient" varchar(255),
  "recipient_email" varchar(500),
  "subject" varchar(500) NOT NULL,
  "body" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "communication_templates_name_uidx"
  ON "communication_templates" ("name");
CREATE INDEX IF NOT EXISTS "communication_templates_active_idx"
  ON "communication_templates" ("is_active");

CREATE TABLE IF NOT EXISTS "comparison_field_overrides" (
  "id" serial PRIMARY KEY,
  "process_id" integer NOT NULL REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "row_key" varchar(160) NOT NULL,
  "field_label" varchar(160) NOT NULL,
  "source_column" varchar(30) NOT NULL,
  "value_text" text,
  "note" text,
  "edited_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "edited_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "comparison_field_overrides_process_id_idx"
  ON "comparison_field_overrides" ("process_id");
CREATE UNIQUE INDEX IF NOT EXISTS "comparison_field_overrides_row_source_uidx"
  ON "comparison_field_overrides" ("process_id", "row_key", "source_column");

CREATE TABLE IF NOT EXISTS "process_custom_stages" (
  "id" serial PRIMARY KEY,
  "process_id" integer NOT NULL REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "label" varchar(160) NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "completed_at" timestamp,
  "notes" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "process_custom_stages_process_id_idx"
  ON "process_custom_stages" ("process_id");
CREATE INDEX IF NOT EXISTS "process_custom_stages_process_position_idx"
  ON "process_custom_stages" ("process_id", "position");

CREATE TABLE IF NOT EXISTS "process_operational_records" (
  "id" serial PRIMARY KEY,
  "process_id" integer NOT NULL REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "record_kind" varchar(30) NOT NULL,
  "record_type" varchar(160) NOT NULL,
  "quantity" integer,
  "amount" numeric(12, 2),
  "currency" varchar(10) DEFAULT 'BRL',
  "notes" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "process_operational_records_process_id_idx"
  ON "process_operational_records" ("process_id");
CREATE INDEX IF NOT EXISTS "process_operational_records_kind_idx"
  ON "process_operational_records" ("process_id", "record_kind");
