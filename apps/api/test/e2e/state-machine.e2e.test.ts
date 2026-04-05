import { describe, it, expect } from 'vitest';
import {
  canTransition,
  getAllowedTransitions,
  assertTransition,
  type ProcessStatus,
} from '../../src/shared/state-machine/process-states.js';
import { InvalidTransitionError } from '../../src/shared/errors/index.js';

// These tests are pure unit tests of the state machine — no Docker required
describe('State Machine — valid transitions', () => {
  it('draft → documents_received', () => {
    expect(canTransition('draft', 'documents_received')).toBe(true);
  });

  it('draft → validating', () => {
    expect(canTransition('draft', 'validating')).toBe(true);
  });

  it('documents_received → validating', () => {
    expect(canTransition('documents_received', 'validating')).toBe(true);
  });

  it('validating → validated', () => {
    expect(canTransition('validating', 'validated')).toBe(true);
  });

  it('validating → draft (validation failed)', () => {
    expect(canTransition('validating', 'draft')).toBe(true);
  });

  it('validated → espelho_generated', () => {
    expect(canTransition('validated', 'espelho_generated')).toBe(true);
  });

  it('espelho_generated → sent_to_fenicia', () => {
    expect(canTransition('espelho_generated', 'sent_to_fenicia')).toBe(true);
  });

  it('sent_to_fenicia → li_pending', () => {
    expect(canTransition('sent_to_fenicia', 'li_pending')).toBe(true);
  });

  it('sent_to_fenicia → completed', () => {
    expect(canTransition('sent_to_fenicia', 'completed')).toBe(true);
  });

  it('li_pending → completed', () => {
    expect(canTransition('li_pending', 'completed')).toBe(true);
  });

  it('re-validation: validated → validating', () => {
    expect(canTransition('validated', 'validating')).toBe(true);
  });

  it('re-validation: espelho_generated → validating', () => {
    expect(canTransition('espelho_generated', 'validating')).toBe(true);
  });
});

describe('State Machine — invalid transitions', () => {
  it('completed → draft is invalid', () => {
    expect(canTransition('completed', 'draft')).toBe(false);
  });

  it('cancelled → validated is invalid', () => {
    expect(canTransition('cancelled', 'validated')).toBe(false);
  });

  it('draft → completed is invalid', () => {
    expect(canTransition('draft', 'completed')).toBe(false);
  });

  it('validated → documents_received is invalid', () => {
    expect(canTransition('validated', 'documents_received')).toBe(false);
  });

  it('li_pending → espelho_generated is invalid', () => {
    expect(canTransition('li_pending', 'espelho_generated')).toBe(false);
  });
});

describe('State Machine — cancel from any active state', () => {
  const cancellableStates: ProcessStatus[] = [
    'draft',
    'documents_received',
    'validating',
    'validated',
    'espelho_generated',
    'sent_to_fenicia',
    'li_pending',
  ];

  for (const state of cancellableStates) {
    it(`${state} → cancelled`, () => {
      expect(canTransition(state, 'cancelled')).toBe(true);
    });
  }
});

describe('State Machine — getAllowedTransitions', () => {
  it('draft has multiple allowed transitions', () => {
    const allowed = getAllowedTransitions('draft');
    expect(allowed).toContain('documents_received');
    expect(allowed).toContain('validating');
    expect(allowed).toContain('cancelled');
  });

  it('completed has no allowed transitions', () => {
    const allowed = getAllowedTransitions('completed');
    expect(allowed).toHaveLength(0);
  });
});

describe('State Machine — assertTransition', () => {
  it('throws InvalidTransitionError on invalid transition', () => {
    expect(() => assertTransition('completed', 'draft')).toThrow(InvalidTransitionError);
  });

  it('does not throw on valid transition', () => {
    expect(() => assertTransition('draft', 'validating')).not.toThrow();
  });
});
