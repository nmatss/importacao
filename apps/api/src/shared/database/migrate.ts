import fs from 'node:fs/promises';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, pool } from './connection.js';

const PENDING_SQL_MIGRATIONS = [
  '0011_proforma_invoice.sql',
  '0012_process_rename_and_lock.sql',
  '0013_ai_usage_log.sql',
  '0014_validation_resolution_note.sql',
  '0015_validation_history.sql',
  '0016_pre_cons_tables.sql',
  '0017_sydle_purchase_payments.sql',
  '0018_validation_run_links.sql',
  '0019_logistic_status_index.sql',
  '0020_document_lineage_and_email_dedupe.sql',
  '0021_sydle_report_columns.sql',
  '0022_odett_operational_feedback.sql',
  '0023_communications_audit.sql',
];

async function applyPendingSqlMigrations(migrationsFolder: string) {
  for (const file of PENDING_SQL_MIGRATIONS) {
    const fullPath = path.join(migrationsFolder, file);
    try {
      const sqlText = await fs.readFile(fullPath, 'utf8');
      console.log(`Applying pending SQL migration ${file}...`);
      await pool.unsafe(sqlText);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        console.warn(`Skipping missing pending SQL migration ${file}`);
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  const migrationsFolder = './drizzle';
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder });
  await applyPendingSqlMigrations(migrationsFolder);
  console.log('Migrations completed successfully.');
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
