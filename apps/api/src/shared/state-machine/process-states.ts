import { InvalidTransitionError } from '../errors/index.js';

export type ProcessStatus = 'draft' | 'documents_received' | 'validating' | 'validated' | 'espelho_generated' | 'sent_to_fenicia' | 'li_pending' | 'completed' | 'cancelled';

interface Transition {
  from: ProcessStatus | ProcessStatus[];
  to: ProcessStatus;
  guard?: (context: TransitionContext) => boolean;
}

interface TransitionContext {
  processId: number;
  userId: number | null;
  metadata?: Record<string, any>;
}

const transitions: Transition[] = [
  { from: 'draft', to: 'documents_received' },
  { from: ['draft', 'documents_received'], to: 'validating' },
  { from: 'validating', to: 'validated' },
  { from: 'validating', to: 'draft' }, // validation failed, back to draft
  { from: 'validated', to: 'espelho_generated' },
  { from: 'espelho_generated', to: 'sent_to_fenicia' },
  { from: 'sent_to_fenicia', to: 'li_pending' },
  { from: ['sent_to_fenicia', 'li_pending'], to: 'completed' },
  { from: ['draft', 'documents_received', 'validating', 'validated', 'espelho_generated', 'sent_to_fenicia', 'li_pending'], to: 'cancelled' },
  // Re-validation paths
  { from: 'validated', to: 'validating' },
  { from: 'espelho_generated', to: 'validating' },
];

export function canTransition(from: ProcessStatus, to: ProcessStatus): boolean {
  return transitions.some(t => {
    const fromStates = Array.isArray(t.from) ? t.from : [t.from];
    return fromStates.includes(from) && t.to === to;
  });
}

export function getAllowedTransitions(from: ProcessStatus): ProcessStatus[] {
  return transitions
    .filter(t => {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      return fromStates.includes(from);
    })
    .map(t => t.to);
}

export function assertTransition(from: ProcessStatus, to: ProcessStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
