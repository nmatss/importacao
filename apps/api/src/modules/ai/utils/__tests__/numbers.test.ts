import { describe, expect, it } from 'vitest';
import { parseDecimal } from '../numbers.js';

describe('parseDecimal', () => {
  it('parses BR-formatted values (dot thousands, comma decimal)', () => {
    expect(parseDecimal('24.312,52')).toBe(24312.52);
    expect(parseDecimal('1.533,60')).toBe(1533.6);
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal('8,00')).toBe(8);
  });

  it('parses US-formatted values (comma thousands, dot decimal)', () => {
    expect(parseDecimal('1,234.56')).toBe(1234.56);
    expect(parseDecimal('8.50')).toBe(8.5);
    expect(parseDecimal('1234.56')).toBe(1234.56);
  });

  it('treats a single comma as a BR decimal (matches KIOM source docs)', () => {
    // In these BR-rendered trade docs a lone comma is the decimal mark.
    expect(parseDecimal('1,234')).toBe(1.234);
  });

  it('reads multi-group thousands that the old parser dropped to NaN', () => {
    expect(parseDecimal('1.234.567')).toBe(1234567); // BR thousands
    expect(parseDecimal('1,234,567')).toBe(1234567); // US thousands
    expect(parseDecimal('12.345.678,90')).toBe(12345678.9);
  });

  it('handles negatives, parentheses and currency noise', () => {
    expect(parseDecimal('-1.234,56')).toBe(-1234.56);
    expect(parseDecimal('(123,45)')).toBe(-123.45);
    expect(parseDecimal('USD 1.020,00')).toBe(1020);
    expect(parseDecimal(1020)).toBe(1020);
  });

  it('rejects ranges, empty and junk', () => {
    expect(parseDecimal('34-39')).toBeNull(); // size range, not a value
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal('-')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });
});
