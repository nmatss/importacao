-- Process rename history + Vimbar lock
-- Apply via standard drizzle migrate or manually:
--   docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0012_process_rename_and_lock.sql

ALTER TABLE "import_processes" ADD COLUMN IF NOT EXISTS "previous_codes" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "import_processes" ADD COLUMN IF NOT EXISTS "locked_at" timestamp;
ALTER TABLE "import_processes" ADD COLUMN IF NOT EXISTS "locked_reason" varchar(50);
