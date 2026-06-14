import { describe, it, expect } from 'vitest';
import { parseLocaleNumber } from '../parser.js';

describe('parseLocaleNumber', () => {
  it('parses Brazilian format with dot grouping and comma decimal', () => {
    expect(parseLocaleNumber('1.234,56')).toBe(1234.56);
  });

  it('parses US/English format with comma grouping and dot decimal', () => {
    expect(parseLocaleNumber('1,234.56')).toBe(1234.56);
  });

  it('parses comma-only as decimal separator', () => {
    expect(parseLocaleNumber('1234,56')).toBe(1234.56);
  });

  it('parses dot-only as decimal separator', () => {
    expect(parseLocaleNumber('1234.56')).toBe(1234.56);
  });

  it('parses Brazilian format with multiple grouping separators', () => {
    expect(parseLocaleNumber('1.234.567,89')).toBe(1234567.89);
  });

  it('parses US format with multiple grouping separators', () => {
    expect(parseLocaleNumber('1,234,567.89')).toBe(1234567.89);
  });

  it('strips Brazilian currency symbol and whitespace', () => {
    expect(parseLocaleNumber('R$ 1.234,56')).toBe(1234.56);
  });

  it('strips USD currency marker', () => {
    expect(parseLocaleNumber('USD 1,234.56')).toBe(1234.56);
  });

  it('handles negative Brazilian values', () => {
    expect(parseLocaleNumber('-1.234,56')).toBe(-1234.56);
  });

  it('passes finite numbers through untouched', () => {
    expect(parseLocaleNumber(1234.56)).toBe(1234.56);
  });

  it('parses plain integers', () => {
    expect(parseLocaleNumber('1234')).toBe(1234);
  });

  it('returns null for empty string', () => {
    expect(parseLocaleNumber('')).toBeNull();
  });

  it('returns null for whitespace only', () => {
    expect(parseLocaleNumber('   ')).toBeNull();
  });

  it('returns null for a lone dash', () => {
    expect(parseLocaleNumber('-')).toBeNull();
  });

  it('returns null for null / undefined', () => {
    expect(parseLocaleNumber(null)).toBeNull();
    expect(parseLocaleNumber(undefined)).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseLocaleNumber('abc')).toBeNull();
  });

  it('returns null for non-finite numbers', () => {
    expect(parseLocaleNumber(NaN)).toBeNull();
    expect(parseLocaleNumber(Infinity)).toBeNull();
  });
});
