import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

// Centralized JWT secret for e2e tests. setupE2EDatabase() exports it onto
// process.env BEFORE the app is dynamically imported, so the app's auth
// middleware verifies tokens minted via signTestToken() with the same secret.
export const E2E_JWT_SECRET = 'test-jwt-secret-for-e2e-tests';

// Seeded users available to every e2e test. The auth middleware looks up the
// user by id and rejects (401) unless the row exists and is active — so a valid
// token alone is not enough; the user must be seeded in the test DB.
export const E2E_ADMIN = { id: 1, email: 'admin@e2e.test', role: 'admin' as const };
export const E2E_ANALYST = { id: 2, email: 'analyst@e2e.test', role: 'analyst' as const };

export interface E2EContext {
  connectionString: string;
  container: StartedPostgreSqlContainer;
  cleanup: () => Promise<void>;
}

// Migrations 0011-0015 ship as .sql files but are intentionally absent from
// Drizzle's meta/_journal.json (some, like 0011, contain ALTER TYPE ADD VALUE
// which cannot run inside the migrator's transaction). They are idempotent
// (IF NOT EXISTS / ADD VALUE IF NOT EXISTS), so we apply them after migrate().
const PENDING_MIGRATIONS = [
  '0011_proforma_invoice.sql',
  '0012_process_rename_and_lock.sql',
  '0013_ai_usage_log.sql',
  '0014_validation_resolution_note.sql',
  '0015_validation_history.sql',
];

async function applyPendingMigrations(client: postgres.Sql): Promise<void> {
  for (const file of PENDING_MIGRATIONS) {
    const full = path.join(MIGRATIONS_FOLDER, file);
    if (!fs.existsSync(full)) continue;
    const sqlText = fs.readFileSync(full, 'utf8');
    // client.unsafe() runs the whole file outside an implicit transaction, so
    // ALTER TYPE ... ADD VALUE in 0011 is allowed.
    await client.unsafe(sqlText);
  }
}

async function seedUsers(client: postgres.Sql): Promise<void> {
  // Stable password hash; e2e tests authenticate via signTestToken(), but
  // seed a real bcrypt hash so a /api/auth/login flow would also work.
  const passwordHash = await bcrypt.hash('e2e-password', 10);
  for (const u of [E2E_ADMIN, E2E_ANALYST]) {
    await client`
      INSERT INTO users (id, name, email, password_hash, role, is_active)
      VALUES (${u.id}, ${u.email.split('@')[0]}, ${u.email}, ${passwordHash}, ${u.role}, true)
      ON CONFLICT (id) DO UPDATE SET is_active = true
    `;
  }
  // Keep the serial sequence ahead of the explicit ids we inserted.
  await client`SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users))`;
}

export async function setupE2EDatabase(): Promise<E2EContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('importacao_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const connectionString = container.getConnectionUri();

  // Run Drizzle migrations, then the pending out-of-journal ones, then seed.
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await applyPendingMigrations(client);
  await seedUsers(client);
  await client.end();

  // Set env BEFORE any test dynamically imports the app/db connection.
  process.env.DATABASE_URL = connectionString;
  process.env.JWT_SECRET = E2E_JWT_SECRET;
  process.env.NODE_ENV = 'test';
  process.env.REDIS_URL = '';

  const cleanup = async () => {
    await container.stop();
  };

  return { connectionString, container, cleanup };
}

// Mint a JWT accepted by the app's authMiddleware. Claims match UserPayload
// ({ id, email, role }) and the secret matches process.env.JWT_SECRET.
export function signTestToken(
  user: { id: number; email: string; role: string } = E2E_ADMIN,
): string {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, E2E_JWT_SECRET, {
    expiresIn: '1h',
  });
}
