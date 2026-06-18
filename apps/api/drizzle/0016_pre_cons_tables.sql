-- Pre-Cons item staging + synchronization audit log.
-- Mirrors apps/api/src/shared/database/schema.ts and is intentionally
-- idempotent for apply-pending-migrations.sh / E2E setup re-runs.

CREATE TABLE IF NOT EXISTS "pre_cons_items" (
  "id" serial PRIMARY KEY,
  "process_code" varchar(50),
  "order_description" varchar(255),
  "etd" date,
  "collection" varchar(100),
  "port_of_loading" varchar(100),
  "supplier" varchar(255),
  "product_name" text,
  "item_code" varchar(50),
  "quantity" integer,
  "agreed_price" numeric(12, 4),
  "ncm_code" varchar(15),
  "requires_reorder" boolean DEFAULT false,
  "requires_import_license" boolean DEFAULT false,
  "amount" numeric(12, 2),
  "able_factor" numeric(12, 2),
  "cbm" numeric(10, 4),
  "cargo_ready_date" date,
  "eta" date,
  "dc_eta" date,
  "pi_number" varchar(50),
  "ean13" varchar(20),
  "color" varchar(100),
  "sheet_name" varchar(100),
  "synced_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pre_cons_items_process_code_idx"
  ON "pre_cons_items" ("process_code");
CREATE INDEX IF NOT EXISTS "pre_cons_items_item_code_idx"
  ON "pre_cons_items" ("item_code");
CREATE INDEX IF NOT EXISTS "pre_cons_items_pi_number_idx"
  ON "pre_cons_items" ("pi_number");

CREATE TABLE IF NOT EXISTS "pre_cons_sync_log" (
  "id" serial PRIMARY KEY,
  "source" varchar(50) NOT NULL,
  "file_name" varchar(255),
  "sheets_processed" integer,
  "total_rows" integer,
  "created" integer,
  "updated" integer,
  "errors" integer,
  "details" jsonb,
  "synced_at" timestamp DEFAULT now()
);
