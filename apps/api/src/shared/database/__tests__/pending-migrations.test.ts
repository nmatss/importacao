import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MIN_PENDING_MIGRATION,
  listPendingSqlMigrationsSync,
  listPendingSqlMigrations,
} from '../pending-migrations.js';

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');

/**
 * Estes casos existem por causa de um defeito real, encontrado em 2026-08-29:
 * o runner de PRODUCAO (`migrate.ts`) enumerava as migrations forward-only numa
 * lista escrita a mao que parou na 0024, enquanto o setup do E2E as descobria
 * com `readdirSync`. A 0025 e a 0026 existiam no disco: o E2E aplicava as duas
 * e passava verde, e producao as pulava em silencio — inclusive a 0026, que cria
 * `documents.ingestion_source`, coluna de que depende todo o contrato de entrada
 * Drive-only.
 *
 * A guarda que importa e a primeira: ela compara a descoberta com o CONTEUDO DO
 * DISCO, entao uma migration nova entra sozinha e uma lista escrita a mao volta
 * a falhar aqui.
 */
describe('descoberta das migrations forward-only', () => {
  const onDisk = fs
    .readdirSync(MIGRATIONS_FOLDER)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();

  it('encontra TODAS as migrations >= 0011 que existem no disco', () => {
    const esperado = onDisk.filter(
      (file) => Number(/^(\d{4})/.exec(file)![1]) >= MIN_PENDING_MIGRATION,
    );

    expect(esperado.length).toBeGreaterThan(0);
    expect(listPendingSqlMigrationsSync(MIGRATIONS_FOLDER)).toEqual(esperado);
  });

  it('inclui a 0025 e a 0026, que a lista escrita a mao pulava', () => {
    const encontradas = listPendingSqlMigrationsSync(MIGRATIONS_FOLDER);

    expect(encontradas).toContain('0025_ai_usage_telemetry.sql');
    expect(encontradas).toContain('0026_document_ingestion_source.sql');
  });

  it('nao aplica as migrations 0000-0010, que o migrator do Drizzle ja cobre', () => {
    const encontradas = listPendingSqlMigrationsSync(MIGRATIONS_FOLDER);
    const abaixoDoPiso = encontradas.filter(
      (file) => Number(/^(\d{4})/.exec(file)![1]) < MIN_PENDING_MIGRATION,
    );

    expect(abaixoDoPiso).toEqual([]);
  });

  it('aplica em ordem numerica — 0011 antes de 0026', () => {
    const encontradas = listPendingSqlMigrationsSync(MIGRATIONS_FOLDER);
    const numeros = encontradas.map((file) => Number(/^(\d{4})/.exec(file)![1]));

    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
  });

  it('a versao assincrona do runner de producao devolve o mesmo que a sincrona do E2E', async () => {
    // A divergencia entre os dois caminhos foi o defeito. Uma implementacao so,
    // e este caso prova que as duas portas de entrada concordam.
    await expect(listPendingSqlMigrations(MIGRATIONS_FOLDER)).resolves.toEqual(
      listPendingSqlMigrationsSync(MIGRATIONS_FOLDER),
    );
  });

  it('ignora arquivo que nao siga o padrao NNNN_nome.sql', () => {
    const encontradas = listPendingSqlMigrationsSync(MIGRATIONS_FOLDER);

    for (const file of encontradas) {
      expect(file).toMatch(/^\d{4}_.+\.sql$/);
    }
  });

  it('toda migration forward-only e idempotente, porque o runner nao guarda estado', () => {
    // O runner reaplica TODAS a cada deploy. Uma migration sem guarda quebraria
    // o segundo deploy — e o primeiro passaria, escondendo o defeito.
    const semGuarda: string[] = [];

    for (const file of listPendingSqlMigrationsSync(MIGRATIONS_FOLDER)) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_FOLDER, file), 'utf8');
      const temDdl = /^\s*(ALTER|CREATE|DROP)\s/im.test(sql);
      const temGuarda = /IF NOT EXISTS|IF EXISTS|DO \$\$/i.test(sql);
      if (temDdl && !temGuarda) semGuarda.push(file);
    }

    expect(semGuarda).toEqual([]);
  });
});
