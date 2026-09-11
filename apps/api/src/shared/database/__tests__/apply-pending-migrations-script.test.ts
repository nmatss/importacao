import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { listPendingSqlMigrationsSync } from '../pending-migrations.js';

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');
const SCRIPT = path.resolve(process.cwd(), '../../scripts/apply-pending-migrations.sh');

/**
 * Guarda ESTATICA do passo [6/8] do `scripts/deploy.sh`.
 *
 * O deploy aplica as migrations com `scripts/apply-pending-migrations.sh`
 * ANTES de reiniciar a API, e esse script enumera os arquivos A MAO. Em
 * 2026-09-11 a lista parava na 0026: a 0027 e a 0028 existiam no disco e so
 * chegaram a producao porque o `migrate.ts` do entrypoint da API as descobre
 * sozinho no boot — ou seja, o codigo novo subia alguns segundos ANTES da
 * coluna de que dependia. E a mesma classe do defeito registrado em
 * `pending-migrations.test.ts`, no outro caminho.
 *
 * O defeito e a AUSENCIA de uma linha num script de infraestrutura; nenhum
 * teste de comportamento o pega, entao a verificacao compara o script com o
 * disco.
 */
function listadasNoScript(): string[] {
  const conteudo = fs.readFileSync(SCRIPT, 'utf8');
  return [...conteudo.matchAll(/^apply\s+(\d{4}_[^\s]+\.sql)\s*$/gm)].map((m) => m[1]);
}

describe('scripts/apply-pending-migrations.sh', () => {
  it('a varredura enxerga o script e o disco', () => {
    // Contraprova: com qualquer lado vazio, a comparacao passaria por vacuidade.
    expect(listadasNoScript().length).toBeGreaterThan(10);
    expect(listPendingSqlMigrationsSync(MIGRATIONS_FOLDER).length).toBeGreaterThan(10);
  });

  it('aplica TODA migration forward-only que existe no disco', () => {
    const noScript = new Set(listadasNoScript());
    const ausentes = listPendingSqlMigrationsSync(MIGRATIONS_FOLDER).filter(
      (file) => !noScript.has(file),
    );

    expect(ausentes).toEqual([]);
  });

  it('nao referencia arquivo que nao existe (o script so avisa e segue)', () => {
    const noDisco = new Set(listPendingSqlMigrationsSync(MIGRATIONS_FOLDER));
    const fantasmas = listadasNoScript().filter((file) => !noDisco.has(file));

    expect(fantasmas).toEqual([]);
  });

  it('aplica em ordem numerica', () => {
    const listadas = listadasNoScript();
    expect(listadas).toEqual([...listadas].sort());
  });
});
