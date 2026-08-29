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
    // `new Date('0')` devolveria 2000-01-01 — 0/false não são datas.
    expect(parseDate(0)).toBeNull();
    expect(parseDate(false)).toBeNull();
  });

  // Regressão: `new Date(Date.UTC(y, m-1, d))` rolava componentes fora de
  // faixa em silêncio — '03/15/2026' virava 2027-03-03 e '32/01/2026' virava
  // 2026-02-01. Uma invoice americana ou um OCR ruim viravam data plausível e
  // errada; agora são rejeitados.
  it.each([
    ['03/15/2026', 'mês 15 (formato americano) não rola para o ano seguinte'],
    ['32/01/2026', 'dia 32 não rola para o mês seguinte'],
    ['31/02/2026', '31 de fevereiro não existe'],
    ['00/01/2026', 'dia zero'],
    ['01/00/2026', 'mês zero'],
    ['2026-13-01', 'mês 13 em ISO'],
    ['2026-02-30', '30 de fevereiro em ISO'],
  ])('rejeita %s (%s)', (input) => {
    expect(parseDate(input)).toBeNull();
  });

  // Sentinela de sistema legado: 01/01/1900 significa "vazio", nunca uma data.
  it.each(['01/01/1900', '1900-01-01', '31/12/1900', '1899-12-31'])(
    'rejeita a sentinela legada %s',
    (input) => {
      expect(parseDate(input)).toBeNull();
    },
  );

  it('mantém 1901 em diante como data real', () => {
    expect(parseDate('01/01/1901')?.toISOString().slice(0, 10)).toBe('1901-01-01');
  });

  it('rejeita um objeto Date com a sentinela legada', () => {
    expect(parseDate(new Date('1900-01-01T00:00:00Z'))).toBeNull();
    expect(parseDate(new Date('2026-03-14T00:00:00Z'))?.toISOString().slice(0, 10)).toBe(
      '2026-03-14',
    );
  });

  it('lê ambíguos como DMY e nunca cai no MM/DD do new Date()', () => {
    expect(parseDate('03/04/2026')?.toISOString().slice(0, 10)).toBe('2026-04-03');
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
