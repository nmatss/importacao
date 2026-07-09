-- Shared communication-draft accountability.
-- Drafts remain collaborative: these columns record the acting user without
-- adding an ownership restriction to the operational workflow.

ALTER TABLE "communications"
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "sent_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "cc_recipients" varchar(500);

CREATE INDEX IF NOT EXISTS "communications_created_by_idx"
  ON "communications" ("created_by");
