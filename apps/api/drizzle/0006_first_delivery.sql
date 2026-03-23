-- Migration 0006: First Delivery - Campos criticos para validacao documental
-- Adiciona campos promovidos da planilha (114 colunas) ao import_processes,
-- expande follow_up_tracking com 8 passos do checklist, e cria document_corrections

-- 1. Novos campos em import_processes (19 campos)
ALTER TABLE import_processes
  ADD COLUMN IF NOT EXISTS purchase_ref         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vessel_name          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bl_number            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_line        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS insurance_value      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS consolidation_ref    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS eta_carrier          DATE,
  ADD COLUMN IF NOT EXISTS eta_actual           DATE,
  ADD COLUMN IF NOT EXISTS container_count      INTEGER,
  ADD COLUMN IF NOT EXISTS freight_agent        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS origin_city          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS inspection_type      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS di_number            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS customs_channel      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS customs_clearance_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cd_arrival_at        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS free_time_days       INTEGER,
  ADD COLUMN IF NOT EXISTS numerario_value      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS numerario_pct        NUMERIC(5,4);

-- 2. Novos campos em follow_up_tracking (8 passos do checklist Manual 4.1)
ALTER TABLE follow_up_tracking
  ADD COLUMN IF NOT EXISTS saved_to_folder_at        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS ncm_bl_checked_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS freight_bl_checked_at     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS espelho_built_at          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS invoice_sent_fenicia_at   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS signatures_collected_at   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS signed_docs_sent_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS di_draft_at               TIMESTAMP;

-- 3. Nova tabela: document_corrections
CREATE TABLE IF NOT EXISTS document_corrections (
  id                      SERIAL PRIMARY KEY,
  process_id              INTEGER NOT NULL REFERENCES import_processes(id) ON DELETE CASCADE,
  validation_run_id       INTEGER REFERENCES validation_runs(id) ON DELETE SET NULL,
  correction_needed       BOOLEAN NOT NULL DEFAULT FALSE,
  error_count             INTEGER DEFAULT 0,
  error_types             JSONB,
  correction_requested_at TIMESTAMP,
  correction_received_at  TIMESTAMP,
  re_validated            BOOLEAN DEFAULT FALSE,
  notes                   TEXT,
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_corrections_process_id_idx ON document_corrections(process_id);
