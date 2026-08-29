import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const dialect = new PgDialect();

/**
 * Serializa uma condicao Drizzle no par (texto SQL, parametros) que o driver
 * enviaria ao Postgres. Permite congelar em teste os limites de data que o
 * service monta, sem precisar de banco.
 */
export function inspectSql(condition: unknown): { text: string; params: unknown[] } {
  const { sql: text, params } = dialect.sqlToQuery(condition as SQL);
  return { text, params };
}

/**
 * Limites de um filtro de periodo: o `>=` e o `<` que o service empilhou, ja
 * convertidos de volta para Date. `null` quando a condicao correspondente nao
 * foi aplicada. O casamento usa o numero do placeholder ($1, $2, ...), entao
 * outros filtros parametrizados na mesma clausula nao deslocam o resultado.
 */
export function dateRangeBounds(condition: unknown): { start: Date | null; end: Date | null } {
  const { text, params } = inspectSql(condition);
  let start: Date | null = null;
  let end: Date | null = null;
  for (const match of text.matchAll(/(>=|<)\s*\$(\d+)/g)) {
    const value = params[Number(match[2]) - 1];
    if (typeof value !== 'string') continue;
    if (match[1] === '>=') start = new Date(value);
    else end = new Date(value);
  }
  return { start, end };
}
