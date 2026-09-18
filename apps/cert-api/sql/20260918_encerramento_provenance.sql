-- Internal provenance from Encerramentos; never infer it from the current certificate.
-- Apply explicitly with release_migrations before starting the new cert-api.
-- Existing snapshots stay NULL until a successful Sheets sync reads the source.
BEGIN;
ALTER TABLE cert_products ADD COLUMN IF NOT EXISTS encerramento_numero_certificado TEXT;
COMMIT;
