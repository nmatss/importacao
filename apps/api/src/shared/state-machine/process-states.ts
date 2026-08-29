import { InvalidTransitionError } from '../errors/index.js';

export type ProcessStatus =
  | 'draft'
  | 'documents_received'
  | 'validating'
  | 'validated'
  | 'espelho_generated'
  | 'sent_to_fenicia'
  | 'li_pending'
  | 'completed'
  | 'cancelled';

// ── TRANSITIONS matrix ──────────────────────────────────────────────────────
// Maps each state to the list of valid destination states.
// This is the single source of truth — getAllowedTransitions and
// assertTransition are derived from this matrix.
export const TRANSITIONS: Record<ProcessStatus, ProcessStatus[]> = {
  draft: ['documents_received', 'validating', 'cancelled'],
  documents_received: ['validating', 'cancelled'],
  // 'validating' -> 'validating' makes re-running validation idempotent:
  // a previous run that failed mid-flight (and left the process stuck in
  // 'validating') can be retried without an InvalidTransitionError.
  validating: ['validated', 'validating', 'draft', 'cancelled'],
  validated: ['espelho_generated', 'validating', 'cancelled'],
  espelho_generated: ['sent_to_fenicia', 'validating', 'cancelled'],
  // 'sent_to_fenicia' -> 'validating' e 'completed' -> 'validating' sao as
  // reaberturas (ver REOPEN_TRANSITIONS): um OHBL corrigido que chega DEPOIS do
  // envio a Fenicia precisa de um caminho suportado de volta a validacao. Antes
  // a operacao contornava isso por `PUT /:id` com `status` no corpo, que pulava
  // esta matriz e nao gravava `status_changed` — o desvio foi fechado, entao o
  // caminho legitimo tem que existir aqui.
  sent_to_fenicia: ['li_pending', 'completed', 'cancelled', 'validating'],
  li_pending: ['completed', 'cancelled'],
  // 'completed' deixou de ser terminal: reabrir para revalidar e cancelar um
  // processo ja concluido sao transicoes de reabertura (motivo + admin +
  // trilha). Nenhuma outra saida foi liberada — 'completed' -> 'draft' continua
  // invalida.
  completed: ['validating', 'cancelled'],
  cancelled: [],
};

/**
 * Transicoes de REABERTURA: andam para tras no fluxo (ou saem de um estado que
 * era terminal). Sao validas na matriz, mas o service exige motivo escrito e
 * papel admin, e grava `process_events` + audit — ver
 * `processService.updateStatus` / `processService.delete`.
 *
 * POLITICA DE USO PENDENTE: a capacidade existe, mas SE a operacao deve poder
 * reabrir um processo concluido e decisao do time fiscal, nao desta camada.
 */
export const REOPEN_TRANSITIONS: ReadonlyArray<readonly [ProcessStatus, ProcessStatus]> = [
  ['sent_to_fenicia', 'validating'],
  ['completed', 'validating'],
  ['completed', 'cancelled'],
];

export function isReopenTransition(from: ProcessStatus, to: ProcessStatus): boolean {
  return REOPEN_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function canTransition(from: ProcessStatus, to: ProcessStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(from: ProcessStatus): ProcessStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function assertTransition(from: ProcessStatus, to: ProcessStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
