ALTER TABLE "alerts" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "currency_exchanges" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "import_processes" ADD COLUMN "correction_status" varchar(30);--> statement-breakpoint
ALTER TABLE "import_processes" ADD COLUMN "payment_terms" jsonb;--> statement-breakpoint
ALTER TABLE "process_items" ADD COLUMN "manufacturer" varchar(255);--> statement-breakpoint
ALTER TABLE "process_items" ADD COLUMN "unit_type" varchar(20);--> statement-breakpoint
ALTER TABLE "process_items" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_process_id_idx" ON "alerts" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "communications_process_id_idx" ON "communications" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "currency_exchanges_process_id_idx" ON "currency_exchanges" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_process_id_idx" ON "documents" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_ingestion_logs_process_id_idx" ON "email_ingestion_logs" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_ingestion_logs_status_idx" ON "email_ingestion_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "espelhos_process_id_idx" ON "espelhos" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_processes_status_idx" ON "import_processes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_processes_brand_idx" ON "import_processes" USING btree ("brand");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "process_items_process_id_idx" ON "process_items" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_results_process_id_idx" ON "validation_results" USING btree ("process_id");