CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."brand" AS ENUM('puket', 'imaginarium');--> statement-breakpoint
CREATE TYPE "public"."communication_status" AS ENUM('draft', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."currency_type" AS ENUM('balance', 'deposit');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('invoice', 'packing_list', 'ohbl', 'espelho', 'li', 'other');--> statement-breakpoint
CREATE TYPE "public"."process_status" AS ENUM('draft', 'documents_received', 'validating', 'validated', 'espelho_generated', 'sent_to_fenicia', 'li_pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('passed', 'failed', 'warning', 'skipped');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer,
	"severity" "alert_severity" NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"sent_to_chat" boolean DEFAULT false,
	"sent_at" timestamp,
	"acknowledged" boolean DEFAULT false,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100),
	"entity_id" integer,
	"details" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "communications" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer,
	"recipient" varchar(255) NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb,
	"status" "communication_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "currency_exchanges" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer NOT NULL,
	"type" "currency_type" NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"exchange_rate" numeric(10, 6),
	"amount_brl" numeric(12, 2),
	"payment_deadline" date,
	"expiration_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer NOT NULL,
	"type" "document_type" NOT NULL,
	"original_filename" varchar(500) NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"mime_type" varchar(100),
	"file_size" integer,
	"drive_file_id" varchar(255),
	"ai_parsed_data" jsonb,
	"confidence_score" numeric(5, 4),
	"is_processed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "espelhos" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer NOT NULL,
	"brand" "brand" NOT NULL,
	"version" integer DEFAULT 1,
	"is_partial" boolean DEFAULT false,
	"generated_data" jsonb,
	"drive_file_id" varchar(255),
	"sent_to_fenicia" boolean DEFAULT false,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "follow_up_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer NOT NULL,
	"documents_received_at" timestamp,
	"pre_inspection_at" timestamp,
	"ncm_verified_at" timestamp,
	"espelho_generated_at" timestamp,
	"sent_to_fenicia_at" timestamp,
	"li_submitted_at" timestamp,
	"li_approved_at" timestamp,
	"li_deadline" date,
	"overall_progress" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "follow_up_tracking_process_id_unique" UNIQUE("process_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_code" varchar(50) NOT NULL,
	"brand" "brand" NOT NULL,
	"status" "process_status" DEFAULT 'draft' NOT NULL,
	"incoterm" varchar(10) DEFAULT 'FOB',
	"port_of_loading" varchar(100),
	"port_of_discharge" varchar(100),
	"etd" date,
	"eta" date,
	"shipment_date" date,
	"total_fob_value" numeric(12, 2),
	"freight_value" numeric(12, 2),
	"total_boxes" integer,
	"total_net_weight" numeric(10, 3),
	"total_gross_weight" numeric(10, 3),
	"total_cbm" numeric(10, 3),
	"exporter_name" varchar(255),
	"exporter_address" text,
	"importer_name" varchar(255),
	"importer_address" text,
	"has_li_items" boolean DEFAULT false,
	"has_certification" boolean DEFAULT false,
	"has_free_of_charge" boolean DEFAULT false,
	"drive_folder_id" varchar(255),
	"ai_extracted_data" jsonb,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "import_processes_process_code_unique" UNIQUE("process_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "process_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer NOT NULL,
	"item_code" varchar(100),
	"description" text,
	"color" varchar(100),
	"size" varchar(50),
	"ncm_code" varchar(20),
	"unit_price" numeric(10, 4),
	"quantity" integer,
	"total_price" numeric(12, 2),
	"box_quantity" integer,
	"net_weight" numeric(10, 3),
	"gross_weight" numeric(10, 3),
	"is_free_of_charge" boolean DEFAULT false,
	"requires_li" boolean DEFAULT false,
	"requires_certification" boolean DEFAULT false,
	"odoo_product_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'analyst' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "validation_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer NOT NULL,
	"check_name" varchar(100) NOT NULL,
	"status" "validation_status" NOT NULL,
	"expected_value" text,
	"actual_value" text,
	"documents_compared" varchar(255),
	"message" text,
	"resolved_manually" boolean DEFAULT false,
	"resolved_by" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communications" ADD CONSTRAINT "communications_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "currency_exchanges" ADD CONSTRAINT "currency_exchanges_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "espelhos" ADD CONSTRAINT "espelhos_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_up_tracking" ADD CONSTRAINT "follow_up_tracking_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_processes" ADD CONSTRAINT "import_processes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "process_items" ADD CONSTRAINT "process_items_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_process_id_import_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."import_processes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
