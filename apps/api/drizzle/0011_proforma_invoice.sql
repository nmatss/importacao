-- Proforma Invoice support
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction. Apply manually:
--   docker cp apps/api/drizzle/0011_proforma_invoice.sql importacao-postgres:/tmp/ \
--     && docker exec importacao-postgres psql -U importacao -d importacao -f /tmp/0011_proforma_invoice.sql

ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'proforma_invoice';
