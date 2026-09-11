-- Dedupe por conteudo, versao do Drive e tombstone de documento excluido
-- (reuniao 2026-09-11, decisoes D1 e D8).
--
-- `content_sha256`/`drive_md5` deixam o sweep do Drive e o upload manual
-- reconhecerem o MESMO arquivo vindo por outro caminho (pasta duplicada do
-- PENDENTES DE CORRECAO, reenvio manual). `drive_version`/`drive_modified_time`
-- distinguem "o mesmo arquivo" de "o espelho foi editado": versao nova vira
-- documento novo. `drive_area` registra de qual area da raiz PROCESSOS o arquivo
-- veio (pendentes, marca, espelhos).
--
-- `document_ingestion_tombstones` e o registro de que um documento foi
-- EXCLUIDO por alguem: o sweep consulta por `drive_file_id` e por
-- `(process_id, content_sha256)` antes de reimportar, para que o documento
-- excluido nao volte sozinho na proxima passada. `document_id` fica sem FK de
-- proposito: a linha em `documents` ja foi apagada quando o tombstone existe.
--
-- Aditiva: todas as colunas novas sao anulaveis e nenhuma linha existente e
-- alterada. `NULL` em `content_sha256` significa "documento anterior a
-- 2026-09-11, hash nunca calculado", nao "sem conteudo".
--
-- Idempotente; safe to run from the forward-only production migration runner.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "content_sha256" varchar(64),
  ADD COLUMN IF NOT EXISTS "drive_md5" varchar(32),
  ADD COLUMN IF NOT EXISTS "drive_version" bigint,
  ADD COLUMN IF NOT EXISTS "drive_modified_time" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "drive_area" text;

CREATE INDEX IF NOT EXISTS "documents_process_content_sha256_idx"
  ON "documents" ("process_id", "content_sha256");

CREATE TABLE IF NOT EXISTS "document_ingestion_tombstones" (
  "id" serial PRIMARY KEY,
  "process_id" integer NOT NULL
    REFERENCES "import_processes"("id") ON DELETE CASCADE,
  "document_id" integer,
  "drive_file_id" text,
  "content_sha256" varchar(64),
  "original_filename" text,
  "deleted_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "document_ingestion_tombstones_drive_file_id_idx"
  ON "document_ingestion_tombstones" ("drive_file_id");

CREATE INDEX IF NOT EXISTS "document_ingestion_tombstones_process_content_idx"
  ON "document_ingestion_tombstones" ("process_id", "content_sha256");
