import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseEspelhoBuffer, parseLocaleNumber } from '../parser.js';

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

describe('parseEspelhoBuffer', () => {
  it('maps English net/gross weight headers from operator spreadsheets', () => {
    const rows = [
      ['IMB TEXTIL S.A.'],
      [],
      ['Process', 'Supplier', 'Code', 'Net Weight', 'Gross Weight', 'Qty', 'Amount'],
      ['IM0712602NB', 'KIOM', 'PI7752Y', '180.50', '200.00', 1000, '2500.00'],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Espelho');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const parsed = parseEspelhoBuffer(buffer);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].codigo).toBe('PI7752Y');
    expect(parsed.items[0].pesoLiquidoTotal).toBe(180.5);
    expect(parsed.items[0].pesoBrutoTotal).toBe(200);
  });
});
