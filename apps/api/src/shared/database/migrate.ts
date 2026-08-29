import fs from 'node:fs/promises';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, pool } from './connection.js';
import { listPendingSqlMigrations, MIN_PENDING_MIGRATION } from './pending-migrations.js';

async function applyPendingSqlMigrations(migrationsFolder: string) {
  const files = await listPendingSqlMigrations(migrationsFolder);
  console.log(`Found ${files.length} forward-only SQL migrations (>= ${MIN_PENDING_MIGRATION}).`);

  for (const file of files) {
    const fullPath = path.join(migrationsFolder, file);
    const sqlText = await fs.readFile(fullPath, 'utf8');
    console.log(`Applying pending SQL migration ${file}...`);
    await pool.unsafe(sqlText);
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
