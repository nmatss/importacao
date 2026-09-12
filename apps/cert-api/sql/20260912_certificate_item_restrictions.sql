-- Apply explicitly before deploying item restriction endpoints. Never called by startup.
-- Additive and rerunnable; NULL keeps each inherited certificate value unchanged.
BEGIN;
ALTER TABLE cert_certificate_items ADD COLUMN IF NOT EXISTS situacao TEXT;
ALTER TABLE cert_certificate_items ADD COLUMN IF NOT EXISTS fim_venda DATE;
ALTER TABLE cert_certificate_items ADD COLUMN IF NOT EXISTS restriction_updated_at TIMESTAMPTZ;
ALTER TABLE cert_certificate_items ADD COLUMN IF NOT EXISTS restriction_updated_by TEXT;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cert_certificate_items'::regclass
                   AND conname = 'cert_item_situacao_valid') THEN
        ALTER TABLE cert_certificate_items ADD CONSTRAINT cert_item_situacao_valid
            CHECK (situacao IS NULL OR situacao IN ('ATIVO', 'ENCERRADO'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cert_certificate_items'::regclass
                   AND conname = 'cert_item_deadline_real') THEN
        ALTER TABLE cert_certificate_items ADD CONSTRAINT cert_item_deadline_real
            CHECK (fim_venda IS NULL OR fim_venda >= DATE '2000-01-01');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cert_certificate_items'::regclass
                   AND conname = 'cert_item_active_without_deadline') THEN
        ALTER TABLE cert_certificate_items ADD CONSTRAINT cert_item_active_without_deadline
            CHECK (situacao IS DISTINCT FROM 'ATIVO' OR fim_venda IS NULL);
    END IF;
END $$;
CREATE TABLE IF NOT EXISTS cert_certificate_item_restriction_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES cert_certificate_items(id) ON DELETE RESTRICT,
    before_state JSONB NOT NULL,
    after_state JSONB NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    actor TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cert_item_restriction_events_item_idx
    ON cert_certificate_item_restriction_events(item_id, created_at);
COMMIT;
