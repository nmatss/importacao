-- SYDLE report parity columns from the consolidated Analytics/export report.
-- Idempotent for apply-pending-migrations.sh / E2E setup re-runs.

ALTER TABLE "sydle_purchase_payments"
  ADD COLUMN IF NOT EXISTS "sydle_protocol" varchar(50),
  ADD COLUMN IF NOT EXISTS "invoice_issued_date" date,
  ADD COLUMN IF NOT EXISTS "task_created_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "shipment_date" date,
  ADD COLUMN IF NOT EXISTS "payment_deadline_after_shipment" integer,
  ADD COLUMN IF NOT EXISTS "exception_status" varchar(50),
  ADD COLUMN IF NOT EXISTS "exception_reason" text;

CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_protocol_idx"
  ON "sydle_purchase_payments" ("sydle_protocol");
CREATE INDEX IF NOT EXISTS "sydle_purchase_payments_shipment_date_idx"
  ON "sydle_purchase_payments" ("shipment_date");
