import { describe, it, expect } from 'vitest';
import { TRANSITIONS, canTransition, getAllowedTransitions, assertTransition } from './process-states.js';
import type { ProcessStatus } from './process-states.js';

describe('TRANSITIONS matrix', () => {
  it('should have entries for all ProcessStatus values', () => {
    const allStatuses: ProcessStatus[] = [
      'draft', 'documents_received', 'validating', 'validated',
      'espelho_generated', 'sent_to_fenicia', 'li_pending', 'completed', 'cancelled',
    ];
    for (const status of allStatuses) {
      expect(TRANSITIONS).toHaveProperty(status);
    }
  });

  it('should allow all valid forward transitions', () => {
    expect(canTransition('draft', 'validating')).toBe(true);
    expect(canTransition('draft', 'documents_received')).toBe(true);
    expect(canTransition('validating', 'validated')).toBe(true);
    expect(canTransition('validated', 'espelho_generated')).toBe(true);
    expect(canTransition('espelho_generated', 'sent_to_fenicia')).toBe(true);
    expect(canTransition('sent_to_fenicia', 'completed')).toBe(true);
  });

  it('should allow cancellation from any active state', () => {
    const activeStates: ProcessStatus[] = [
      'draft', 'documents_received', 'validating', 'validated',
      'espelho_generated', 'sent_to_fenicia', 'li_pending',
    ];
    for (const state of activeStates) {
      expect(canTransition(state, 'cancelled')).toBe(true);
    }
  });

  it('should allow re-validation from validated and espelho_generated', () => {
    expect(canTransition('validated', 'validating')).toBe(true);
    expect(canTransition('espelho_generated', 'validating')).toBe(true);
  });

  it('should block illegal jumps', () => {
    expect(canTransition('draft', 'completed')).toBe(false);
    expect(canTransition('validating', 'espelho_generated')).toBe(false);
    expect(canTransition('completed', 'draft')).toBe(false);
    expect(canTransition('cancelled', 'validated')).toBe(false);
  });
});

describe('getAllowedTransitions', () => {
  it('should return empty array for terminal states', () => {
    expect(getAllowedTransitions('completed')).toEqual([]);
    expect(getAllowedTransitions('cancelled')).toEqual([]);
  });

  it('should include cancelled for all non-terminal states', () => {
    const nonTerminal: ProcessStatus[] = [
      'draft', 'documents_received', 'validating', 'validated',
      'espelho_generated', 'sent_to_fenicia', 'li_pending',
    ];
    for (const state of nonTerminal) {
      expect(getAllowedTransitions(state)).toContain('cancelled');
    }
  });
});

describe('assertTransition', () => {
  it('should not throw for valid transitions', () => {
    expect(() => assertTransition('draft', 'validating')).not.toThrow();
    expect(() => assertTransition('validating', 'validated')).not.toThrow();
  });

  it('should throw InvalidTransitionError for illegal transitions', () => {
    expect(() => assertTransition('completed', 'draft')).toThrow();
    expect(() => assertTransition('cancelled', 'validated')).toThrow();
    expect(() => assertTransition('draft', 'completed')).toThrow();
  });
});
