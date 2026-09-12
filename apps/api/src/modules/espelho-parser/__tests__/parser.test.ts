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
  it('reads official summary layout without mixing CNPJ into address', () => {
    const rows = [
      ['IMPORTADOR TESTE', '', '', 'TOTAL PCS', 13963],
      ['CNPJ: 00.000.000/0001-00', '', '', 'PESO BRUTO', 5941.5],
      ['RUA TESTE 100', '', '', 'PESO LIQUIDO', 5242.5],
      ['CIDADE TESTE - SC', '', '', 'CBM', 65.527],
      ['', '', '', 'TOTAL CAIXAS', 699],
      [],
      ['', '', '', 'FOB', 85313.93],
      ['Process', 'Supplier', 'Code', 'Qty', 'Amount'],
      ['PK2192607SZ', 'FORNECEDOR TESTE', '050404509', 13963, 85313.93],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Espelho');
    const parsed = parseEspelhoBuffer(
      XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    );
    expect(parsed.summary).toMatchObject({
      importerName: 'IMPORTADOR TESTE',
      importerCnpj: '00.000.000/0001-00',
      importerAddress: 'RUA TESTE 100 CIDADE TESTE - SC',
      totalPieces: 13963,
      totalGrossWeight: 5941.5,
      totalNetWeight: 5242.5,
      totalCbm: 65.527,
      totalBoxes: 699,
      totalAmountUsd: 85313.93,
    });
  });

  it('reads an explicit commercial unit separately from unit price and leaves missing units unknown', () => {
    for (const withUnit of [true, false]) {
      const rows = [
        ['IMPORTADOR TESTE', '', '', 'TOTAL PCS', 10],
        [
          'Process',
          'Supplier',
          'Code',
          'Qty',
          'Unit Price',
          ...(withUnit ? ['Unidade comercial'] : []),
        ],
        ['PK2192607SZ', 'FORNECEDOR', '050404509', 10, 2.5, ...(withUnit ? ['PAR'] : [])],
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Espelho');
      const parsed = parseEspelhoBuffer(
        XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      );
      expect(parsed.items[0].unitPrice).toBe(2.5);
      expect(parsed.items[0].unitType).toBe(withUnit ? 'PAR' : null);
      expect(parsed.items[0].qty).toBe(10);
    }
  });

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
