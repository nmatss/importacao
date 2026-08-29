-- Linhagem de origem em process_items (ADR 0006, auditoria 2026-08-29).
--
-- `autoPopulateItems` materializava itens a partir de uma invoice escolhida sem
-- ordenacao e sem registrar DE QUAL documento e de QUAL execucao de extracao
-- eles vieram. A ADR 0006 exige a origem por item para que o comparativo e a
-- validacao possam distinguir dado lido de dado projetado.
--
-- As colunas sao anulaveis de proposito: as linhas ja existentes foram
-- materializadas antes de haver linhagem e nao ha como reconstrui-la
-- retroativamente. `NULL` aqui significa "origem desconhecida, anterior a
-- 2026-08-29", nao "sem origem".
--
-- Idempotente; safe to run from the forward-only production migration runner.

ALTER TABLE "process_items"
  ADD COLUMN IF NOT EXISTS "source_document_id" integer,
  ADD COLUMN IF NOT EXISTS "extraction_run_id" integer,
  ADD COLUMN IF NOT EXISTS "materialized_at" timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'process_items_source_document_id_fk'
  ) THEN
    ALTER TABLE "process_items"
      ADD CONSTRAINT "process_items_source_document_id_fk"
      FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "process_items_source_document_id_idx"
  ON "process_items" ("source_document_id");
