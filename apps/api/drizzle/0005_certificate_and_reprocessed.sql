-- Migration 0005: Add certificate document type and reprocessed email status
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Apply manually: docker cp this file into the postgres container, then run:
--   psql -U postgres -d importacao -f /tmp/0005_certificate_and_reprocessed.sql

-- Add 'certificate' to document_type enum
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'certificate';

-- Add 'reprocessed' to email_ingestion_status enum
ALTER TYPE "email_ingestion_status" ADD VALUE IF NOT EXISTS 'reprocessed';
