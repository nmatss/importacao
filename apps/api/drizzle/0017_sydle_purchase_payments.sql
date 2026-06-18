-- SYDLE purchase/payment report staging + synchronization audit.
-- Idempotent for apply-pending-migrations.sh / E2E setup re-runs.

CREATE TABLE IF NOT EXISTS "sydle_purchase_payments" (
  "id" serial PRIMARY KEY,
  "external_id" varchar(255) NOT NULL,
  "source_system" varchar(50) NOT NULL DEFAULT 'sydle',
  "process_id" integer REFERENCES "import_processes"("id") ON DELETE SET NULL,
  "match_status" varchar(20) NOT NULL DEFAULT 'unmatched',
  "match_score" numeric(5, 4),
  "match_reason" text,
  "process_code" varchar(50),
  "purchase_ref" varchar(100),
  "purchase_order" varchar(100),
  "proforma_number" varchar(100),
  "invoice_number" varchar(100),
  "supplier_name" varchar(255),
  "brand" varchar(50),
  "currency" varchar(3) NOT NULL DEFAULT 'USD',
  "purchase_amount" numeric(14, 2),
  "paid_amount" numeric(14, 2),
  "open_amount" numeric(14, 2),
  "payment_type" varchar(30) NOT NULL DEFAULT 'other',
  "payment_status" varchar(30) NOT NULL DEFAULT 'unknown',
  "due_date" date,
  "paid_at" timestamptz,
  "scheduled_at" timestamptz,
  "exchange_rate" numeric(10, 6),
  "amount_brl" numeric(14, 2),
  "bank_name" varchar(255),
  "contract_number" varchar(100),
  "remittance_id" varchar(100),
  "source_updated_at" timestamptz,
  "raw_payload" jsonb,
  "synced_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "sydle_purchase_payments_external_id_idx"
  ON "sydle_purchase_payments" ("external_id");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_process_id_idx"
  ON "sydle_purchase_payments" ("process_id");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_process_code_idx"
  ON "sydle_purchase_payments" ("process_code");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_purchase_ref_idx"
  ON "sydle_purchase_payments" ("purchase_ref");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_supplier_idx"
  ON "sydle_purchase_payments" ("supplier_name");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_due_date_idx"
  ON "sydle_purchase_payments" ("due_date");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_payment_status_idx"
  ON "sydle_purchase_payments" ("payment_status");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_match_status_idx"
  ON "sydle_purchase_payments" ("match_status");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_source_updated_idx"
  ON "sydle_purchase_payments" ("source_updated_at");

CREATE TABLE IF NOT EXISTS "sydle_sync_runs" (
  "id" serial PRIMARY KEY,
  "status" varchar(20) NOT NULL DEFAULT 'running',
  "trigger" varchar(20) NOT NULL DEFAULT 'cron',
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "duration" integer,
  "cursor_from" timestamptz,
  "cursor_to" timestamptz,
  "fetched" integer DEFAULT 0,
  "created" integer DEFAULT 0,
  "updated" integer DEFAULT 0,
  "unchanged" integer DEFAULT 0,
  "matched" integer DEFAULT 0,
  "unmatched" integer DEFAULT 0,
  "errors" integer DEFAULT 0,
  "error_message" text,
  "metadata" jsonb
);

CREATE INDEX IF NOT EXISTS "sydle_sync_runs_status_idx"
  ON "sydle_sync_runs" ("status");
CREATE INDEX IF NOT EXISTS "sydle_sync_runs_started_at_idx"
  ON "sydle_sync_runs" ("started_at");
