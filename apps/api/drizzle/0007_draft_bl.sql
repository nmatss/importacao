-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction.
-- Apply manually: docker cp apps/api/drizzle/0007_draft_bl.sql importacao-postgres:/tmp/ && docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0007_draft_bl.sql

ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'draft_bl';

ALTER TABLE import_processes ADD COLUMN IF NOT EXISTS logistic_status VARCHAR(50);
ALTER TABLE import_processes ADD COLUMN IF NOT EXISTS document_stage VARCHAR(30) DEFAULT 'pre_con';
