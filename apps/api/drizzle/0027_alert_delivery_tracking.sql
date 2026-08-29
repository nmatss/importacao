-- Reentrega de alerta (auditoria 2026-08-29).
--
-- Ate aqui `sent_to_chat = false` nao era lido por NENHUM job, rota ou servico
-- do repositorio: alerta que falhava na entrega morria no banco. E a
-- deduplicacao devolvia o alerta duplicado ANTES de tentar entregar, entao uma
-- falha na primeira tentativa do dia impedia todas as seguintes daquela janela.
-- Foi assim que a tabela chegou a 6.349 registros com `sent_to_chat = true` em
-- ZERO.
--
-- Estas colunas dao ao job de reentrega o estado minimo para tentar de novo com
-- backoff e parar de tentar em algum momento, sem reprocessar a base inteira a
-- cada passada.
--
-- Idempotente; safe to run from the forward-only production migration runner.

ALTER TABLE "alerts"
  ADD COLUMN IF NOT EXISTS "delivery_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_delivery_attempt_at" timestamp,
  ADD COLUMN IF NOT EXISTS "last_delivery_error" text;

-- Indice parcial: a varredura de reentrega so olha o que ainda nao foi
-- entregue, que e uma fracao pequena da tabela.
CREATE INDEX IF NOT EXISTS "alerts_undelivered_idx"
  ON "alerts" ("created_at")
  WHERE "sent_to_chat" = false;
