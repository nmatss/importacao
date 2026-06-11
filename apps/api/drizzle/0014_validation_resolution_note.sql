-- Manual resolution justification for validation results (#10).
-- Stores the operator's mandatory note when a failed check is resolved by hand.
-- Pure ADD — safe to apply via drizzle-kit migrate.

ALTER TABLE "validation_results" ADD COLUMN IF NOT EXISTS "resolution_note" text;
