import { describe, it, expect } from 'vitest';
import {
  TRANSITIONS,
  REOPEN_TRANSITIONS,
  canTransition,
  getAllowedTransitions,
  assertTransition,
  isReopenTransition,
} from './process-states.js';
import type { ProcessStatus } from './process-states.js';

describe('TRANSITIONS matrix', () => {
  it('should have entries for all ProcessStatus values', () => {
    const allStatuses: ProcessStatus[] = [
      'draft',
      'documents_received',
      'validating',
      'validated',
      'espelho_generated',
      'sent_to_fenicia',
      'li_pending',
      'completed',
      'cancelled',
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
      'draft',
      'documents_received',
      'validating',
      'validated',
      'espelho_generated',
      'sent_to_fenicia',
      'li_pending',
    ];
    for (const state of activeStates) {
      expect(canTransition(state, 'cancelled')).toBe(true);
    }
  });

  it('should allow re-validation from validated and espelho_generated', () => {
    expect(canTransition('validated', 'validating')).toBe(true);
    expect(canTransition('espelho_generated', 'validating')).toBe(true);
  });

  it('should allow idempotent re-validation from validating (no 400 on retry)', () => {
    // A run that failed mid-flight can leave the process stuck in 'validating';
    // re-running validation must not raise InvalidTransitionError.
    expect(canTransition('validating', 'validating')).toBe(true);
    expect(() => assertTransition('validating', 'validating')).not.toThrow();
  });

  it('should block illegal jumps', () => {
    expect(canTransition('draft', 'completed')).toBe(false);
    expect(canTransition('validating', 'espelho_generated')).toBe(false);
    expect(canTransition('completed', 'draft')).toBe(false);
    expect(canTransition('cancelled', 'validated')).toBe(false);
  });

  // Um OHBL corrigido que chega DEPOIS do envio a Fenicia precisa de um caminho
  // suportado de volta a validacao. Sem estas transicoes a operacao ficava sem
  // saida nenhuma (o desvio por `PUT /:id` com `status` no corpo foi fechado).
  it('should allow reopening for re-validation after sent_to_fenicia', () => {
    expect(canTransition('sent_to_fenicia', 'validating')).toBe(true);
  });

  it('should allow reopening a completed process for re-validation', () => {
    expect(canTransition('completed', 'validating')).toBe(true);
  });

  it('should allow cancelling a completed process', () => {
    expect(canTransition('completed', 'cancelled')).toBe(true);
  });

  it('should not open any other exit from completed', () => {
    expect(getAllowedTransitions('completed').sort()).toEqual(['cancelled', 'validating']);
    expect(canTransition('completed', 'draft')).toBe(false);
    expect(canTransition('completed', 'li_pending')).toBe(false);
    expect(canTransition('completed', 'espelho_generated')).toBe(false);
  });

  it('keeps cancelled terminal', () => {
    expect(getAllowedTransitions('cancelled')).toEqual([]);
  });
});

describe('REOPEN_TRANSITIONS', () => {
  it('flags exactly the three backwards transitions', () => {
    expect(isReopenTransition('sent_to_fenicia', 'validating')).toBe(true);
    expect(isReopenTransition('completed', 'validating')).toBe(true);
    expect(isReopenTransition('completed', 'cancelled')).toBe(true);
    expect(REOPEN_TRANSITIONS).toHaveLength(3);
  });

  it('does not flag normal forward transitions or ordinary cancels', () => {
    expect(isReopenTransition('validated', 'validating')).toBe(false);
    expect(isReopenTransition('espelho_generated', 'validating')).toBe(false);
    expect(isReopenTransition('sent_to_fenicia', 'completed')).toBe(false);
    expect(isReopenTransition('draft', 'cancelled')).toBe(false);
    expect(isReopenTransition('li_pending', 'cancelled')).toBe(false);
  });

  it('every reopen transition is actually valid in the matrix', () => {
    for (const [from, to] of REOPEN_TRANSITIONS) {
      expect(canTransition(from, to)).toBe(true);
    }
  });
});

describe('getAllowedTransitions', () => {
  // 'completed' deixou de ser terminal: reabrir para revalidar e cancelar sao
  // transicoes de reabertura (motivo + admin + trilha). 'cancelled' continua
  // sem saida.
  it('should return empty array for cancelled (still terminal)', () => {
    expect(getAllowedTransitions('cancelled')).toEqual([]);
  });

  it('should include cancelled for all non-terminal states', () => {
    const nonTerminal: ProcessStatus[] = [
      'draft',
      'documents_received',
      'validating',
      'validated',
      'espelho_generated',
      'sent_to_fenicia',
      'li_pending',
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
