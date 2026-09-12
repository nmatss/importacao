import { describe, it, expect } from 'vitest';
import {
  isSpreadsheetError,
  normalizeHeader,
  parseDateTimeParts,
  parseLocalizedNumber,
  parseSpreadsheetDateISO,
  readDateCell,
  readDateTimeCell,
  readIntegerCell,
  readNumberCell,
  readTextCell,
} from '../spreadsheet-parse.js';

/**
 * Valores REAIS da planilha Follow Up (linhas do PK2192607SZ, PK2202608SZ e
 * IM0762607NB, lidas em 11/09/2026).
 */
describe('parseLocalizedNumber', () => {
  it('le moeda pt-BR sem dividir por mil', () => {
    // A regra antiga (`replace(',', '.')` depois de tirar o simbolo) devolvia
    // 101.346 — o FOB do processo mil vezes menor.
    expect(parseLocalizedNumber('$101.346,01')).toBe(101346.01);
    expect(parseLocalizedNumber('$85.313,93')).toBe(85313.93);
    expect(parseLocalizedNumber('10.000,00')).toBe(10000);
  });

  it('le decimal com virgula e com ponto', () => {
    expect(parseLocalizedNumber('0,5')).toBe(0.5);
    expect(parseLocalizedNumber('120,25')).toBe(120.25);
    expect(parseLocalizedNumber('5,09620')).toBe(5.0962);
    expect(parseLocalizedNumber('1,432')).toBe(1.432);
    expect(parseLocalizedNumber(179.67)).toBe(179.67);
  });

  it('devolve null para texto que nao e numero', () => {
    expect(parseLocalizedNumber('#ERROR!')).toBeNull();
    expect(parseLocalizedNumber('-')).toBeNull();
    expect(parseLocalizedNumber('')).toBeNull();
    expect(parseLocalizedNumber('EM TEMPO')).toBeNull();
  });
});

describe('parseSpreadsheetDateISO', () => {
  it('le a data pt-BR sem deslocar o dia', () => {
    expect(parseSpreadsheetDateISO('08/09/2026')).toBe('2026-09-08');
    expect(parseSpreadsheetDateISO('07/08/2026')).toBe('2026-08-07');
    expect(parseSpreadsheetDateISO('2026-09-17')).toBe('2026-09-17');
  });

  it('recusa data inexistente e texto livre', () => {
    expect(parseSpreadsheetDateISO('31/02/2026')).toBeNull();
    expect(parseSpreadsheetDateISO('EM TEMPO')).toBeNull();
    expect(parseSpreadsheetDateISO('#ERROR!')).toBeNull();
  });
});

describe('parseDateTimeParts', () => {
  it('separa o dia da hora do desembaraco', () => {
    expect(parseDateTimeParts('08/09/2026 12:11:50')).toEqual({
      date: '2026-09-08',
      time: '12:11:50',
    });
  });

  it('deixa time nulo quando a celula so tem o dia', () => {
    expect(parseDateTimeParts('11/09/2026')).toEqual({ date: '2026-09-11', time: null });
  });

  it('recusa hora invalida', () => {
    expect(parseDateTimeParts('08/09/2026 25:00')).toBeNull();
  });
});

describe('leitura de celula (disponivel x indisponivel)', () => {
  it('marca #ERROR! como indisponivel, com o motivo', () => {
    const reading = readNumberCell('#ERROR!');
    expect(reading.available).toBe(false);
    if (!reading.available) expect(reading.reason).toContain('erro de formula');
    expect(isSpreadsheetError('#ERROR!')).toBe(true);
  });

  it('nunca transforma celula vazia em zero', () => {
    const reading = readNumberCell('');
    expect(reading.available).toBe(false);
    if (!reading.available) expect(reading.reason).toBe('celula vazia');
  });

  it('marca tracinho como ausencia, nao como valor', () => {
    expect(readTextCell('-').available).toBe(false);
    expect(readNumberCell('-').available).toBe(false);
  });

  it('le texto livre na data de registro como indisponivel', () => {
    const reading = readDateCell('EM TEMPO');
    expect(reading.available).toBe(false);
    if (!reading.available) expect(reading.reason).toContain('EM TEMPO');
  });

  it('le valores validos', () => {
    expect(readNumberCell('$101.346,01')).toEqual({ available: true, value: 101346.01 });
    expect(readIntegerCell('2')).toEqual({ available: true, value: 2 });
    expect(readDateCell('08/09/2026')).toEqual({ available: true, value: '2026-09-08' });
    expect(readDateTimeCell('08/09/2026 12:11:50')).toEqual({
      available: true,
      value: { date: '2026-09-08', time: '12:11:50' },
    });
    expect(readTextCell("40'NOR", 50)).toEqual({ available: true, value: "40'NOR" });
  });
});

describe('normalizeHeader', () => {
  it('ignora acento, caixa, espaco duplicado e o asterisco de obrigatoriedade', () => {
    expect(normalizeHeader('ETA Final*')).toBe('ETA FINAL');
    expect(normalizeHeader('Desembaraço')).toBe('DESEMBARACO');
    expect(normalizeHeader('Enviar Invoice  Fenicia*')).toBe('ENVIAR INVOICE FENICIA');
    expect(normalizeHeader('Número de Registro DI / DUIMP')).toBe('NUMERO DE REGISTRO DI / DUIMP');
  });

  it('distingue ETA Previsto de ETA Previsto Medio', () => {
    expect(normalizeHeader('ETA Previsto')).not.toBe(normalizeHeader('ETA Previsto Médio'));
  });
});
