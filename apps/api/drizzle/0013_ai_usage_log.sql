-- AI usage log for monthly budget cap (R$ 1000 ≈ USD 200 default).
-- Pure ADD — safe to apply via drizzle-kit migrate.

CREATE TABLE IF NOT EXISTS "ai_usage_log" (
  "id" serial PRIMARY KEY,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "provider" varchar(20) NOT NULL,
  "model" varchar(100) NOT NULL,
  "context" varchar(100),
  "input_tokens" integer DEFAULT 0,
  "output_tokens" integer DEFAULT 0,
  "cost_usd" numeric(12, 6) DEFAULT 0,
  "status" varchar(20) DEFAULT 'success'
);

CREATE INDEX IF NOT EXISTS "ai_usage_log_created_at_idx" ON "ai_usage_log" ("created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_log_provider_idx" ON "ai_usage_log" ("provider");
