import { describe, it, expect } from 'vitest';
import {
  businessDaysBetween,
  isBusinessDay,
  localDateIso,
  localDayStartForInstant,
  localWeekKey,
  isSameLocalDay,
} from '../dates.js';

/**
 * Dias uteis no calendario do operador (America/Sao_Paulo), que e onde a regra
 * de "processo sem movimentacao" passa a viver. Os containers rodam em UTC,
 * entao toda contagem feita com o relogio do processo erra entre 21:00 e 23:59
 * no Brasil — o mesmo defeito que ja mordeu o filtro de periodo dos alertas.
 */
describe('localDateIso()', () => {
  it('converte um instante para o dia do operador, nao o dia UTC', () => {
    // 21:30 em Brasilia ja e o dia seguinte em UTC.
    expect(localDateIso(new Date('2026-09-12T00:30:00Z'))).toBe('2026-09-11');
    expect(localDateIso(new Date('2026-09-11T12:00:00Z'))).toBe('2026-09-11');
  });

  it('data de calendario passa intacta, sem voltar um dia', () => {
    // 'YYYY-MM-DD' por `new Date()` vira meia-noite UTC e, em Brasilia, o dia
    // anterior: e o "ETD 06/08" com a invoice em 07/08.
    expect(localDateIso('2026-08-07')).toBe('2026-08-07');
  });

  it('recusa lixo em vez de inventar uma data', () => {
    expect(() => localDateIso('nao e data')).toThrow();
  });
});

describe('isBusinessDay()', () => {
  it('segunda a sexta sim, sabado e domingo nao', () => {
    expect(isBusinessDay('2026-09-11')).toBe(true); // sexta
    expect(isBusinessDay('2026-09-12')).toBe(false); // sabado
    expect(isBusinessDay('2026-09-13')).toBe(false); // domingo
    expect(isBusinessDay('2026-09-14')).toBe(true); // segunda
  });

  it('usa o dia do operador, e nao o dia UTC do container', () => {
    // 2026-09-12T00:30:00Z ainda e sexta 21:30 em Brasilia.
    expect(isBusinessDay(new Date('2026-09-12T00:30:00Z'))).toBe(true);
    // 2026-09-14T02:00:00Z ja e domingo 23:00 em Brasilia.
    expect(isBusinessDay(new Date('2026-09-14T02:00:00Z'))).toBe(false);
  });
});

describe('businessDaysBetween()', () => {
  it('o fim de semana nao conta', () => {
    expect(businessDaysBetween('2026-09-11', '2026-09-14')).toBe(1); // sexta -> segunda
    expect(businessDaysBetween('2026-09-11', '2026-09-12')).toBe(0); // sexta -> sabado
    expect(businessDaysBetween('2026-09-11', '2026-09-13')).toBe(0); // sexta -> domingo
  });

  it('o mesmo dia e zero, e datas invertidas nao ficam negativas', () => {
    expect(businessDaysBetween('2026-09-11', '2026-09-11')).toBe(0);
    expect(businessDaysBetween('2026-09-18', '2026-09-11')).toBe(0);
  });

  it('conta semanas inteiras sem se perder', () => {
    expect(businessDaysBetween('2026-09-07', '2026-09-11')).toBe(4);
    expect(businessDaysBetween('2026-09-07', '2026-09-21')).toBe(10);
    expect(businessDaysBetween('2026-08-25', '2026-09-11')).toBe(13);
  });

  it('e aditiva: a soma dos trechos e o total', () => {
    // A cadencia do digest depende disso para saber em que ponto o processo
    // estava quando foi avisado, sem guardar nada.
    const total = businessDaysBetween('2026-08-25', '2026-09-30');
    const primeiro = businessDaysBetween('2026-08-25', '2026-09-11');
    const segundo = businessDaysBetween('2026-09-11', '2026-09-30');
    expect(primeiro + segundo).toBe(total);
  });

  it('aceita instante e data de calendario na mesma conta', () => {
    expect(businessDaysBetween(new Date('2026-09-08T20:30:00Z'), '2026-09-11')).toBe(3);
  });
});

describe('localDayStartForInstant()', () => {
  it('devolve a meia-noite local do dia que contem o instante', () => {
    expect(localDayStartForInstant(new Date('2026-09-11T12:00:00Z')).toISOString()).toBe(
      '2026-09-11T03:00:00.000Z',
    );
    // 21:30 local: o dia UTC ja virou, o dia do operador nao.
    expect(localDayStartForInstant(new Date('2026-09-12T00:30:00Z')).toISOString()).toBe(
      '2026-09-11T03:00:00.000Z',
    );
  });
});

describe('isSameLocalDay()', () => {
  it('compara o dia do operador, nao o UTC', () => {
    expect(isSameLocalDay(new Date('2026-09-11T12:00:00Z'), new Date('2026-09-12T02:00:00Z'))).toBe(
      true,
    );
    expect(isSameLocalDay(new Date('2026-09-11T12:00:00Z'), new Date('2026-09-12T12:00:00Z'))).toBe(
      false,
    );
  });
});

describe('localWeekKey()', () => {
  it('a semana e estavel de segunda a domingo', () => {
    const segunda = localWeekKey('2026-09-07');
    expect(localWeekKey('2026-09-11')).toBe(segunda);
    expect(localWeekKey('2026-09-13')).toBe(segunda);
    expect(localWeekKey('2026-09-14')).not.toBe(segunda);
  });

  it('tem o formato de chave curta usada no topico do Chat', () => {
    expect(localWeekKey('2026-09-11')).toMatch(/^\d{4}-S\d{2}$/);
  });
});
