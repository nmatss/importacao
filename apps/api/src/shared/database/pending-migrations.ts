import fs from 'node:fs';
import fsp from 'node:fs/promises';

/**
 * Fonte UNICA de descoberta das migrations forward-only.
 *
 * Migrations 0011+ sao arquivos .sql deliberadamente fora do
 * `drizzle/meta/_journal.json` — algumas, como a 0011, contem
 * `ALTER TYPE ... ADD VALUE`, que nao roda dentro da transacao do migrator.
 * Todas sao idempotentes, entao sao aplicadas depois do `migrate()`.
 *
 * POR QUE ISTO E UM MODULO PROPRIO: ate 2026-08-29 existiam DUAS
 * implementacoes deste passo. O runner de producao
 * (`shared/database/migrate.ts`) tinha uma lista ENUMERADA A MAO que parou na
 * 0024, enquanto `test/e2e/setup.ts` descobria os arquivos com `readdirSync`.
 * Resultado: a 0025 e a 0026 existiam no disco, o E2E as aplicava e passava
 * verde, e o caminho de PRODUCAO as pulava em silencio — inclusive a 0026, que
 * cria `documents.ingestion_source`, de que depende todo o contrato de entrada
 * Drive-only.
 *
 * Com uma implementacao so, acrescentar uma migration passa a bastar: nao ha
 * lista para lembrar de atualizar, e nao ha como os dois caminhos divergirem.
 */
export const MIN_PENDING_MIGRATION = 11;

const MIGRATION_FILE_PATTERN = /^(\d{4})_.+\.sql$/;

function selectPending(entries: string[]): string[] {
  return entries
    .filter((file) => {
      const match = MIGRATION_FILE_PATTERN.exec(file);
      return match !== null && Number(match[1]) >= MIN_PENDING_MIGRATION;
    })
    .sort();
}

/** Versao sincrona, para o setup do E2E. */
export function listPendingSqlMigrationsSync(migrationsFolder: string): string[] {
  return selectPending(fs.readdirSync(migrationsFolder));
}

/** Versao assincrona, para o runner de producao. */
export async function listPendingSqlMigrations(migrationsFolder: string): Promise<string[]> {
  return selectPending(await fsp.readdir(migrationsFolder));
}
