import { describe, it, expect } from 'vitest';
import {
  formatDate,
  addDays,
  daysBetween,
  isDeadlineCritical,
  calculateLiDeadline,
  isCalendarDate,
  localDayStartUtc,
  localDayEndExclusiveUtc,
  localTodayIso,
  localMonthStartUtc,
} from '../dates.js';

describe('formatDate', () => {
  it('should format a Date object to YYYY-MM-DD', () => {
    const date = new Date(2025, 0, 15); // Jan 15, 2025
    expect(formatDate(date)).toBe('2025-01-15');
  });

  it('should format a date string to YYYY-MM-DD', () => {
    expect(formatDate('2025-06-05T12:00:00Z')).toBe('2025-06-05');
  });

  it('should pad single-digit months and days', () => {
    const date = new Date(2025, 2, 5); // Mar 5, 2025
    expect(formatDate(date)).toBe('2025-03-05');
  });
});

describe('addDays', () => {
  it('should add days to a date', () => {
    const date = new Date(2025, 0, 1);
    const result = addDays(date, 10);
    expect(result.getDate()).toBe(11);
    expect(result.getMonth()).toBe(0);
  });

  it('should handle month rollover', () => {
    const date = new Date(2025, 0, 28);
    const result = addDays(date, 5);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(2);
  });

  it('should handle negative days', () => {
    const date = new Date(2025, 0, 15);
    const result = addDays(date, -5);
    expect(result.getDate()).toBe(10);
  });

  it('should not mutate the original date', () => {
    const date = new Date(2025, 0, 1);
    addDays(date, 10);
    expect(date.getDate()).toBe(1);
  });
});

describe('daysBetween', () => {
  it('should calculate days between two dates', () => {
    const d1 = new Date(2025, 0, 1);
    const d2 = new Date(2025, 0, 11);
    expect(daysBetween(d1, d2)).toBe(10);
  });

  it('should return absolute difference regardless of order', () => {
    const d1 = new Date(2025, 0, 11);
    const d2 = new Date(2025, 0, 1);
    expect(daysBetween(d1, d2)).toBe(10);
  });

  it('should return 0 for same date', () => {
    const d = new Date(2025, 5, 15);
    expect(daysBetween(d, d)).toBe(0);
  });
});

describe('isDeadlineCritical', () => {
  it('should return true when deadline is within warning days', () => {
    const now = new Date();
    const deadline = addDays(now, 2);
    expect(isDeadlineCritical(deadline, 3)).toBe(true);
  });

  it('should return false when deadline is far away', () => {
    const now = new Date();
    const deadline = addDays(now, 30);
    expect(isDeadlineCritical(deadline, 3)).toBe(false);
  });

  it('should return false when deadline is in the past', () => {
    const now = new Date();
    const deadline = addDays(now, -5);
    expect(isDeadlineCritical(deadline, 3)).toBe(false);
  });

  it('should use default warning days of 3', () => {
    const now = new Date();
    const deadline = addDays(now, 2);
    expect(isDeadlineCritical(deadline)).toBe(true);
  });
});

describe('calculateLiDeadline', () => {
  it('should return date 13 days after shipment', () => {
    const shipment = new Date(2025, 0, 1);
    const deadline = calculateLiDeadline(shipment);
    expect(deadline.getDate()).toBe(14);
    expect(deadline.getMonth()).toBe(0);
  });
});

describe('isCalendarDate', () => {
  it('aceita uma data de calendario real', () => {
    expect(isCalendarDate('2026-08-29')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
  });

  it('rejeita formato invalido', () => {
    expect(isCalendarDate('29/08/2026')).toBe(false);
    expect(isCalendarDate('abc')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });

  it('rejeita dia que nao existe no mes, em vez de rolar para o mes seguinte', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2025-02-29')).toBe(false);
  });
});

describe('localDayStartUtc / localDayEndExclusiveUtc', () => {
  it('converte a meia-noite local no instante UTC correspondente', () => {
    // America/Sao_Paulo esta em UTC-3, entao 00:00 local e 03:00Z.
    expect(localDayStartUtc('2026-08-29')?.toISOString()).toBe('2026-08-29T03:00:00.000Z');
  });

  it('o limite superior e o inicio do dia local SEGUINTE, exclusivo', () => {
    expect(localDayEndExclusiveUtc('2026-08-29')?.toISOString()).toBe('2026-08-30T03:00:00.000Z');
  });

  it('o intervalo cobre o dia local inteiro — este era o defeito', () => {
    const start = localDayStartUtc('2026-08-29')!.getTime();
    const end = localDayEndExclusiveUtc('2026-08-29')!.getTime();

    // Registro exibido na tela como "29/08 22:00" tem created_at 2026-08-30T01:00Z.
    // Com o limite antigo (meia-noite UTC) ele ficava de fora do filtro "29/08".
    const ultimoInstanteDoDiaLocal = Date.parse('2026-08-30T02:59:59.999Z');
    expect(ultimoInstanteDoDiaLocal).toBeGreaterThanOrEqual(start);
    expect(ultimoInstanteDoDiaLocal).toBeLessThan(end);

    // E a noite do dia ANTERIOR nao pode entrar.
    const noiteDoDiaAnterior = Date.parse('2026-08-29T02:59:59.999Z');
    expect(noiteDoDiaAnterior).toBeLessThan(start);

    // O primeiro instante do dia seguinte fica fora.
    expect(end).toBe(Date.parse('2026-08-30T03:00:00.000Z'));
  });

  it('devolve null para entrada invalida em vez de estourar RangeError', () => {
    expect(localDayStartUtc('abc')).toBeNull();
    expect(localDayEndExclusiveUtc('abc')).toBeNull();
    expect(localDayStartUtc('2026-02-30')).toBeNull();
  });

  it('atravessa a virada de mes e de ano', () => {
    expect(localDayEndExclusiveUtc('2026-12-31')?.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    expect(localDayEndExclusiveUtc('2026-01-31')?.toISOString()).toBe('2026-02-01T03:00:00.000Z');
  });
});

describe('localTodayIso / localMonthStartUtc', () => {
  it('usa o dia local, nao o dia UTC, na virada da noite', () => {
    // 2026-09-01T01:00Z ainda e 31/08 as 22:00 em Sao Paulo.
    expect(localTodayIso(new Date('2026-09-01T01:00:00.000Z'))).toBe('2026-08-31');
  });

  it('o mes corrente segue o calendario local', () => {
    const start = localMonthStartUtc(0, new Date('2026-09-01T01:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('o mes anterior e resolvido a partir do mes local', () => {
    const previous = localMonthStartUtc(-1, new Date('2026-09-15T12:00:00.000Z'));
    expect(previous.toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('atravessa a virada de ano para tras', () => {
    const previous = localMonthStartUtc(-1, new Date('2026-01-10T12:00:00.000Z'));
    expect(previous.toISOString()).toBe('2025-12-01T03:00:00.000Z');
  });
});
