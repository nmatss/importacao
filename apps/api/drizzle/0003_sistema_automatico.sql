ALTER TABLE "import_processes" ADD COLUMN "container_type" varchar(50);
ALTER TABLE "import_processes" ADD COLUMN "sistema_drive_folder_id" varchar(255);
ALTER TABLE "validation_results" ADD COLUMN "data_source" varchar(50) DEFAULT 'cross_document';
