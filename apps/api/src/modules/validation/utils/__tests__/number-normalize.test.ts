import { describe, expect, it } from 'vitest';

import {
  describeNumericFailure,
  extractTrailingUnit,
  isAbsent,
  isUnusable,
  parseDocumentNumber,
  parseSystemNumber,
  type ParsedNumericFail,
} from '../number-normalize.js';

describe('parseDocumentNumber', () => {
  const cases: Array<[unknown, number]> = [
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1234.56 KGS', 1234.56],
    // a unidade tem de sair ANTES da limpeza: senao o "3" de "M3" entra no numero
    ['12,45 M3', 12.45],
    ['2.5M3', 2.5],
    ['US$ 1.234,56', 1234.56],
    ['(1.234,56)', -1234.56],
    ['-1.234,56', -1234.56],
    ['1.234.567', 1234567],
    ['1,234,567.89', 1234567.89],
    ['0.500', 0.5],
    ['1234.567', 1234.567],
    ['12,5', 12.5],
    ['2.44', 2.44],
    ['115', 115],
    [0, 0],
    [-3.5, -3.5],
    ['0', 0],
    ['  250,00  ', 250],
    ['12 CBM', 12],
  ];

  it.each(cases)('parses %o as %o', (input, expected) => {
    const parsed = parseDocumentNumber(input);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toBeCloseTo(expected, 6);
  });

  it('preserves zero as a value, never as absent', () => {
    const parsed = parseDocumentNumber(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toBe(0);
    expect(isAbsent(parsed)).toBe(false);
  });

  it.each([null, undefined, '', '   '])('reports %o as absent', (input) => {
    const parsed = parseDocumentNumber(input);
    expect(parsed.ok).toBe(false);
    expect(isAbsent(parsed)).toBe(true);
    expect(isUnusable(parsed)).toBe(false);
  });

  it.each(['abc', 'N/A', 'PREPAID', '1.2.3', NaN, {}])(
    'reports %o as unparseable (present but not a number)',
    (input) => {
      const parsed = parseDocumentNumber(input);
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.reason).toBe('unparseable');
      expect(isAbsent(parsed)).toBe(false);
    },
  );

  // CONGELA A DECISAO documentada no cabecalho de number-normalize.ts:
  // um unico separador com exatamente 3 digitos depois e 1-3 digitos (sem zero
  // a esquerda) antes NAO e resolvido por chute — vira 'ambiguous'.
  it.each(['1.234', '1,234', '12.345', '123.456', '999,000'])(
    'refuses to guess the decimal separator of %s',
    (input) => {
      const parsed = parseDocumentNumber(input);
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.reason).toBe('ambiguous');
      // ambiguo NAO e ausente: o dado existe no documento
      expect(isAbsent(parsed)).toBe(false);
      expect(isUnusable(parsed)).toBe(true);
    },
  );

  it('keeps the raw text so the operator can check the document', () => {
    const parsed = parseDocumentNumber('1.234');
    expect(!parsed.ok && parsed.raw).toBe('1.234');
    expect(describeNumericFailure('Peso bruto INV', parsed as ParsedNumericFail)).toContain(
      '"1.234"',
    );
  });

  it('does not treat a leading-zero group as thousands', () => {
    const parsed = parseDocumentNumber('0.750');
    expect(parsed.ok && parsed.value).toBe(0.75);
  });
});

describe('extractTrailingUnit', () => {
  it.each([
    ['1234.56 KGS', 'KGS'],
    ['2,5 M3', 'M3'],
    ['12CBM', 'CBM'],
    ['1234 lb', 'LB'],
    ['1.234,56', null],
    ['US$ 1.234,56', null],
    [null, null],
  ])('extracts the unit of %o as %o', (input, expected) => {
    expect(extractTrailingUnit(input)).toBe(expected);
  });
});

describe('parseSystemNumber', () => {
  // Postgres numeric(10,3) devolve "2.440"; interpretar o ponto como milhar
  // (heuristica de documento) corromperia o valor em 1000x.
  it.each([
    ['2.440', 2.44],
    ['12.345', 12.345],
    ['1160.00', 1160],
    ['0.000', 0],
    [250, 250],
  ])('reads the Postgres numeric string %o as %o', (input, expected) => {
    const parsed = parseSystemNumber(input);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toBeCloseTo(expected, 6);
  });

  it.each([null, undefined, ''])('reports %o as absent', (input) => {
    expect(isAbsent(parseSystemNumber(input))).toBe(true);
  });

  it('reports garbage as unparseable, not absent', () => {
    const parsed = parseSystemNumber('n/d');
    expect(!parsed.ok && parsed.reason).toBe('unparseable');
  });
});

describe('describeNumericFailure', () => {
  it('never describes a present value as missing', () => {
    const ambiguous = parseDocumentNumber('1.234') as ParsedNumericFail;
    const absent = parseDocumentNumber(null) as ParsedNumericFail;
    expect(describeNumericFailure('CBM PL', ambiguous)).not.toContain('nao informado');
    expect(describeNumericFailure('CBM PL', absent)).toContain('nao informado');
  });
});
