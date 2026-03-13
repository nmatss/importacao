-- 0004_schema_improvements.sql
-- ON DELETE CASCADE/SET NULL, composite indices, updated_at columns, new tables

-- ── ON DELETE behaviors ──────────────────────────────────────────────────

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_process_id_import_processes_id_fk";
ALTER TABLE "documents" ADD CONSTRAINT "documents_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE CASCADE;

ALTER TABLE "process_items" DROP CONSTRAINT IF EXISTS "process_items_process_id_import_processes_id_fk";
ALTER TABLE "process_items" ADD CONSTRAINT "process_items_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE CASCADE;

ALTER TABLE "validation_results" DROP CONSTRAINT IF EXISTS "validation_results_process_id_import_processes_id_fk";
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE CASCADE;

ALTER TABLE "currency_exchanges" DROP CONSTRAINT IF EXISTS "currency_exchanges_process_id_import_processes_id_fk";
ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE CASCADE;

ALTER TABLE "follow_up_tracking" DROP CONSTRAINT IF EXISTS "follow_up_tracking_process_id_import_processes_id_fk";
ALTER TABLE "follow_up_tracking" ADD CONSTRAINT "follow_up_tracking_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE CASCADE;

ALTER TABLE "espelhos" DROP CONSTRAINT IF EXISTS "espelhos_process_id_import_processes_id_fk";
ALTER TABLE "espelhos" ADD CONSTRAINT "espelhos_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE CASCADE;

ALTER TABLE "li_tracking" DROP CONSTRAINT IF EXISTS "li_tracking_process_id_import_processes_id_fk";
ALTER TABLE "li_tracking" ADD CONSTRAINT "li_tracking_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE SET NULL;

ALTER TABLE "alerts" DROP CONSTRAINT IF EXISTS "alerts_process_id_import_processes_id_fk";
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE SET NULL;

ALTER TABLE "communications" DROP CONSTRAINT IF EXISTS "communications_process_id_import_processes_id_fk";
ALTER TABLE "communications" ADD CONSTRAINT "communications_process_id_import_processes_id_fk"
  FOREIGN KEY ("process_id") REFERENCES "import_processes"("id") ON DELETE SET NULL;

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_users_id_fk";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;

-- ── Composite indices ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "import_processes_status_brand_idx" ON "import_processes" ("status", "brand");
CREATE INDEX IF NOT EXISTS "import_processes_status_updated_idx" ON "import_processes" ("status", "updated_at");

CREATE INDEX IF NOT EXISTS "validation_results_process_status_resolved_idx" ON "validation_results" ("process_id", "status", "resolved_manually");

CREATE INDEX IF NOT EXISTS "currency_exchanges_payment_deadline_idx" ON "currency_exchanges" ("payment_deadline");

CREATE INDEX IF NOT EXISTS "documents_process_type_idx" ON "documents" ("process_id", "type");

CREATE INDEX IF NOT EXISTS "alerts_severity_idx" ON "alerts" ("severity");
CREATE INDEX IF NOT EXISTS "alerts_acknowledged_idx" ON "alerts" ("acknowledged");

-- ── Add updated_at columns ───────────────────────────────────────────────

ALTER TABLE "validation_results" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT NOW();
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT NOW();
ALTER TABLE "email_ingestion_logs" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT NOW();
ALTER TABLE "espelhos" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT NOW();

-- ── Create validation_runs table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "validation_runs" (
  "id" SERIAL PRIMARY KEY,
  "process_id" INTEGER NOT NULL REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "triggered_by" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "trigger_type" VARCHAR(50) NOT NULL DEFAULT 'manual',
  "total_checks" INTEGER,
  "passed_checks" INTEGER,
  "failed_checks" INTEGER,
  "warning_checks" INTEGER,
  "duration" INTEGER,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "validation_runs_process_id_idx" ON "validation_runs" ("process_id");

-- ── Create job_runs table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "job_runs" (
  "id" SERIAL PRIMARY KEY,
  "job_name" VARCHAR(100) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'running',
  "started_at" TIMESTAMP DEFAULT NOW(),
  "completed_at" TIMESTAMP,
  "duration" INTEGER,
  "result" JSONB,
  "error_message" TEXT,
  "metadata" JSONB
);

CREATE INDEX IF NOT EXISTS "job_runs_job_name_idx" ON "job_runs" ("job_name");
CREATE INDEX IF NOT EXISTS "job_runs_status_idx" ON "job_runs" ("status");

-- ── Trigram GIN index for fast LIKE/ILIKE searches ───────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "import_processes_process_code_trgm_idx" ON "import_processes" USING gin ("process_code" gin_trgm_ops);

-- ── Unique constraint on espelhos ────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "espelhos_process_version_partial_uniq" ON "espelhos" ("process_id", "version", "is_partial");
