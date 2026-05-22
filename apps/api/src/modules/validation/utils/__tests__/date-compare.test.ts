import { describe, it, expect } from 'vitest';
import { parseDate, daysBetween, compareDates } from '../date-compare.js';

describe('parseDate', () => {
  it('parses ISO dates', () => {
    expect(parseDate('2026-03-14')?.toISOString().slice(0, 10)).toBe('2026-03-14');
  });

  it('parses DD/MM/YYYY', () => {
    expect(parseDate('14/03/2026')?.toISOString().slice(0, 10)).toBe('2026-03-14');
  });

  it('parses DD-MMM-YYYY text', () => {
    expect(parseDate('14-Mar-2026')?.toISOString().slice(0, 10)).toBe('2026-03-14');
  });

  it('returns null for empty/garbage', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('returns absolute day difference', () => {
    const a = new Date('2026-03-14T00:00:00Z');
    const b = new Date('2026-03-17T00:00:00Z');
    expect(daysBetween(a, b)).toBe(3);
    expect(daysBetween(b, a)).toBe(3);
  });
});

describe('compareDates', () => {
  it('matches when invoice 14/03 and BL 16/03 (≤7 days)', () => {
    const result = compareDates(['2026-03-14', '2026-03-16']);
    expect(result).toBe('match');
  });

  it('warns when difference is 14 days (>7, ≤30)', () => {
    const result = compareDates(['2026-03-14', '2026-03-28']);
    expect(result).toBe('warning');
  });

  it('flags divergent when difference >30 days', () => {
    const result = compareDates(['2026-03-14', '2026-04-15']);
    expect(result).toBe('divergent');
  });

  it('returns empty when only one date parses', () => {
    expect(compareDates(['2026-03-14', null])).toBe('empty');
    expect(compareDates(['not-a-date'])).toBe('empty');
  });

  it('handles 3 sources (invoice + PL + BL)', () => {
    const result = compareDates(['2026-03-14', '2026-03-15', '2026-03-16']);
    expect(result).toBe('match');
  });
});
