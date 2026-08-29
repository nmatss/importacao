import { z } from 'zod';
import { isCalendarDate } from '../utils/dates.js';

/**
 * Data de calendario 'YYYY-MM-DD' vinda de um filtro da interface.
 *
 * Sem esta validacao, o service recebia string livre e `new Date('abc')`
 * chegava em `.toISOString()`, que lanca `RangeError: Invalid time value`.
 * O try/catch do controller transformava isso em HTTP 400 com a mensagem
 * interna em ingles "Invalid time value", incompreensivel para o operador.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine(isCalendarDate, 'Data inválida');

/** Aplica a coerencia entre inicio e fim de um intervalo opcional. */
export function refineDateRange<T extends { startDate?: string; endDate?: string }>(value: T) {
  return !value.startDate || !value.endDate || value.startDate <= value.endDate;
}

export const dateRangeRefinement = {
  message: 'A data inicial não pode ser posterior à data final',
  path: ['endDate'],
};
