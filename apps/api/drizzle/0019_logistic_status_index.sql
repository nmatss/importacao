-- Index for the Sydle purchase/payment report's "process phase" filter.
-- The report joins sydle_purchase_payments -> import_processes and filters by
-- import_processes.logistic_status; without this index every phase filter does a
-- sequential scan on import_processes (DBA audit 2026-06-20, P1).
-- Idempotent for apply-pending-migrations.sh / E2E setup re-runs.

CREATE INDEX IF NOT EXISTS "import_processes_logistic_status_idx"
  ON "import_processes" ("logistic_status");
