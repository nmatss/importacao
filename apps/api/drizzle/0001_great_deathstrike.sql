CREATE TYPE "public"."email_ingestion_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'ignored');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_ingestion_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" varchar(500) NOT NULL,
	"from_address" varchar(255) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"received_at" timestamp NOT NULL,
	"process_id" integer,
	"status" "email_ingestion_status" DEFAULT 'pending' NOT NULL,
	"attachments_count" integer DEFAULT 0,
	"processed_attachments" jsonb,
	"error_message" text,
	"process_code" varchar(50),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "email_ingestion_logs_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_ingestion_logs" ADD CONSTRAINT "email_ingestion_logs_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
