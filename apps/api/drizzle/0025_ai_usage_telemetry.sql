-- Telemetria de governança consolidada no ai_usage_log (análise IA 2026-07-17).
-- O antigo governance.ts guardava latência/prompt-version/erro só em memória
-- (sumia no restart; a tabela ai_request_logs prometida na "migration 0004"
-- nunca existiu). Uma chamada de IA = uma linha, com custo E telemetria.
-- Idempotente; safe to run from the forward-only production migration runner.

ALTER TABLE "ai_usage_log"
  ADD COLUMN IF NOT EXISTS "latency_ms" integer,
  ADD COLUMN IF NOT EXISTS "prompt_version" varchar(50),
  ADD COLUMN IF NOT EXISTS "error_message" text;
