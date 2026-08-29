import { describe, expect, it } from 'vitest';
import { DATE_VALUE_PATTERN, findLabeledDate, normalizeDate } from '../dates.js';

describe('normalizeDate — many formats to ISO-8601', () => {
  it('passes through ISO and tolerates slash/dot ISO separators', () => {
    expect(normalizeDate('2024-03-15')).toBe('2024-03-15');
    expect(normalizeDate('2024/03/15')).toBe('2024-03-15');
    expect(normalizeDate('2024.03.15')).toBe('2024-03-15');
  });

  it('parses dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy', () => {
    expect(normalizeDate('15/03/2024')).toBe('2024-03-15');
    expect(normalizeDate('15-03-2024')).toBe('2024-03-15');
    expect(normalizeDate('15.03.2024')).toBe('2024-03-15');
  });

  it('expands 2-digit years to 20xx', () => {
    expect(normalizeDate('15/03/24')).toBe('2024-03-15');
    expect(normalizeDate('22-Feb-26')).toBe('2026-02-22');
  });

  it('parses dd-MMM-yyyy and dd MMM yyyy (English)', () => {
    expect(normalizeDate('15-Mar-2024')).toBe('2024-03-15');
    expect(normalizeDate('15 Mar 2024')).toBe('2024-03-15');
    expect(normalizeDate('15-MAR-24')).toBe('2024-03-15');
  });

  it('parses PT-BR month abbreviations', () => {
    expect(normalizeDate('15-dez-2024')).toBe('2024-12-15');
    expect(normalizeDate('15 fev 2024')).toBe('2024-02-15');
    expect(normalizeDate('01-set-2024')).toBe('2024-09-01');
  });

  it('parses "March 15, 2024" and "Mar 15 2024"', () => {
    expect(normalizeDate('March 15, 2024')).toBe('2024-03-15');
    expect(normalizeDate('Mar 15 2024')).toBe('2024-03-15');
    expect(normalizeDate('March 1st, 2024')).toBe('2024-03-01');
  });

  it('parses PT-BR long form "15 de marco de 2024" (with/without accent)', () => {
    expect(normalizeDate('15 de marco de 2024')).toBe('2024-03-15');
    expect(normalizeDate('15 de março de 2024')).toBe('2024-03-15');
    expect(normalizeDate('1 de janeiro de 2025')).toBe('2025-01-01');
  });

  it('resolves mm/dd vs dd/mm with the documented heuristic', () => {
    // first > 12 → must be the day (dd/mm)
    expect(normalizeDate('15/03/2024')).toBe('2024-03-15');
    // second > 12 → first must be the month (mm/dd)
    expect(normalizeDate('03/15/2024')).toBe('2024-03-15');
    // both <= 12 → ambiguous, defaults to dd/mm
    expect(normalizeDate('05/06/2024')).toBe('2024-06-05');
  });

  it('rejects impossible calendar dates', () => {
    expect(normalizeDate('31/02/2024')).toBeNull();
    expect(normalizeDate('00/01/2024')).toBeNull();
    expect(normalizeDate('13/13/2024')).toBeNull();
  });

  it('rejects the 01/01/1900 legacy "empty" sentinel instead of returning a real date', () => {
    // Linx/WMS enviam 01/01/1900 como "vazio". O lado Python já corta
    // (`if parsed.year <= 1900: return None`); sem o mesmo corte aqui a
    // sentinela entrava em aiParsedData e era comparada como data real.
    expect(normalizeDate('01/01/1900')).toBeNull();
    expect(normalizeDate('1900-01-01')).toBeNull();
    expect(normalizeDate('31/12/1900')).toBeNull();
    expect(normalizeDate('1899-12-31')).toBeNull();
    // 1901 em diante continua sendo data válida.
    expect(normalizeDate('01/01/1901')).toBe('1901-01-01');
  });

  it('returns null for non-dates and empties', () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate('not a date')).toBeNull();
    expect(normalizeDate('FOB')).toBeNull();
  });
});

describe('findLabeledDate — anchors on the broad label set', () => {
  it('finds an invoice date label', () => {
    expect(findLabeledDate('Invoice Date: 15/03/2024')).toBe('2024-03-15');
  });

  it('finds CI date with no separator (compact PDF layout)', () => {
    expect(findLabeledDate('CI DATE22-Feb-26')).toBe('2026-02-22');
  });

  it('finds PT-BR labels (data emissao / data da fatura)', () => {
    expect(findLabeledDate('Data Emissao: 15/03/2024')).toBe('2024-03-15');
    expect(findLabeledDate('Data da Fatura: 15 de março de 2024')).toBe('2024-03-15');
  });

  it('finds shipment/on board/ETD/B-L date labels', () => {
    expect(findLabeledDate('Shipment Date: 2024-03-15')).toBe('2024-03-15');
    expect(findLabeledDate('On Board: 15-Mar-2024')).toBe('2024-03-15');
    expect(findLabeledDate('ETD 15/03/2024')).toBe('2024-03-15');
    expect(findLabeledDate('B/L Date: 15/03/24')).toBe('2024-03-15');
  });

  it('honors a custom label list', () => {
    expect(findLabeledDate('Validade: 15/03/2024', ['validade'])).toBe('2024-03-15');
    expect(findLabeledDate('Invoice Date: 15/03/2024', ['validade'])).toBeNull();
  });

  it('returns null when no labeled date is present', () => {
    expect(findLabeledDate('no dates here at all')).toBeNull();
    expect(findLabeledDate('')).toBeNull();
  });
});

describe('DATE_VALUE_PATTERN', () => {
  it('matches each supported shape', () => {
    const re = new RegExp(`^(?:${DATE_VALUE_PATTERN})$`, 'i');
    for (const s of [
      '2024-03-15',
      '15/03/2024',
      '15-03-24',
      '15.03.2024',
      '22-Feb-26',
      '15 Mar 2024',
      'March 15, 2024',
      '15 de marco de 2024',
    ]) {
      expect(re.test(s), s).toBe(true);
    }
  });
});
