import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { importProcesses } from '../../shared/database/schema.js';

/**
 * FONTES DE DATA DOS KPIs DE PRAZO
 * ================================
 *
 * `import_processes.updated_at` NAO e a data de um evento: `processService.update`
 * grava `updatedAt: new Date()` em TODA edicao, inclusive de campos que nada tem
 * a ver com o estagio. Editar uma nota num processo concluido em janeiro
 * recontabilizava esse processo como "concluido neste mes" e zerava o tempo de
 * permanencia dele no estagio.
 *
 * As fontes corretas sao append-only e ja existem:
 *
 *  1. `process_events` com `event_type = 'status_changed'` — registra QUANDO a
 *     transicao aconteceu, com autoria. E a fonte PREFERIDA para qualquer
 *     indicador de "entrou no estagio X" / "concluiu".
 *  2. as colunas de marco em `follow_up_tracking` (`espelho_generated_at`,
 *     `sent_to_fenicia_at`, ...) — preferidas quando o marco e o proprio evento
 *     de negocio e nao uma transicao de status (ex: espelho gerado).
 *
 * FALLBACK: processos anteriores ao `process_events` nao tem evento nenhum.
 * Para nao sumirem dos paineis, essas linhas caem de volta em `updated_at` e o
 * indicador e marcado como APROXIMADO na resposta da API (campos
 * `*Approximate` / `*FallbackCount`), em vez de fingir precisao.
 *
 * CUSTO: cada expressao abaixo e uma subquery correlacionada, resolvida pelo
 * indice `process_events_created_at_idx (process_id, created_at)` — um seek por
 * linha do recorte, nao um N+1 de ida e volta ao banco. O filtro
 * `metadata->>'newStatus'` nao tem indice proprio; ele so roda sobre as poucas
 * linhas ja restritas por `process_id`.
 */

/** Momento (MAX) em que o processo entrou no status literal informado. */
export function statusEnteredAt(status: string): SQL<Date | null> {
  return sql<Date | null>`(
    SELECT MAX(pe.created_at) FROM process_events pe
     WHERE pe.process_id = ${importProcesses.id}
       AND pe.event_type = 'status_changed'
       AND pe.metadata->>'newStatus' = ${status}
  )`;
}

/** Momento (MAX) em que o processo entrou no status ATUAL dele. */
export function currentStatusEnteredAt(): SQL<Date | null> {
  return sql<Date | null>`(
    SELECT MAX(pe.created_at) FROM process_events pe
     WHERE pe.process_id = ${importProcesses.id}
       AND pe.event_type = 'status_changed'
       AND pe.metadata->>'newStatus' = ${importProcesses.status}::text
  )`;
}

/** A mesma expressao, com o fallback documentado para processos sem evento. */
export function withUpdatedAtFallback(expr: SQL<Date | null>): SQL<Date> {
  return sql<Date>`COALESCE(${expr}, ${importProcesses.updatedAt})`;
}

/** `true` na linha cujo valor veio do fallback — ou seja, e aproximado. */
export function isApproximate(expr: SQL<Date | null>): SQL<boolean> {
  return sql<boolean>`(${expr} IS NULL)`;
}

/** Quantas linhas do agregado cairam no fallback. */
export function approximateCount(expr: SQL<Date | null>): SQL<number> {
  return sql<number>`COUNT(*) FILTER (WHERE ${expr} IS NULL)::int`;
}
