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
  validating: ['validated', 'draft', 'cancelled'],
  validated: ['espelho_generated', 'validating', 'cancelled'],
  espelho_generated: ['sent_to_fenicia', 'validating', 'cancelled'],
  sent_to_fenicia: ['li_pending', 'completed', 'cancelled'],
  li_pending: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

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
