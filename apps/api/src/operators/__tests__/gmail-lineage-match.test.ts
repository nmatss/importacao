import { describe, expect, it } from 'vitest';
import { decideExactHashTarget, normalizeProcessCode } from '../gmail-lineage-match.js';

const target = { documentId: 10, processId: 20, processCode: 'IMP-2026-001' };

describe('decideExactHashTarget', () => {
  it('accepts a unique exact hash when the process code agrees', () => {
    expect(decideExactHashTarget([target], ['IMP_2026_001'])).toEqual({
      kind: 'exact',
      target,
      processCodeAligned: true,
    });
  });

  it('accepts a unique exact hash when the source has no recognized process code', () => {
    expect(decideExactHashTarget([target], [])).toEqual({
      kind: 'exact',
      target,
      processCodeAligned: false,
    });
  });

  it('rejects collisions and process conflicts', () => {
    expect(decideExactHashTarget([target, { ...target, documentId: 11 }], [])).toEqual({
      kind: 'ambiguous_hash',
    });
    expect(decideExactHashTarget([target], ['OTHER-2026-999'])).toEqual({
      kind: 'process_conflict',
    });
  });

  it('normalizes separators and case', () => {
    expect(normalizeProcessCode(' imp_2026 001 ')).toBe('IMP2026001');
  });
});
