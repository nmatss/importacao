import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

export interface E2EContext {
  connectionString: string;
  container: StartedPostgreSqlContainer;
  cleanup: () => Promise<void>;
}

export async function setupE2EDatabase(): Promise<E2EContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('importacao_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const connectionString = container.getConnectionUri();

  // Run Drizzle migrations
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await client.end();

  const cleanup = async () => {
    await container.stop();
  };

  return { connectionString, container, cleanup };
}
