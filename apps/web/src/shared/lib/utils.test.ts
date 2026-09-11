import { afterEach, describe, expect, it } from 'vitest';
import { formatCurrency, formatDate, formatDateOnly, formatDateTime, relativeTime } from './utils';

describe('formatCurrency', () => {
  it('formats ISO 4217 currency codes normally', () => {
    expect(formatCurrency(1234.56, 'usd')).toMatch(/US\$\s?1\.234,56/);
  });

  it('does not throw when an external source sends a non-currency label', () => {
    expect(formatCurrency(1234.56, 'PREPAID')).toBe('1.234,56 PREPAID');
  });
});

// Node relê process.env.TZ a cada atribuicao, entao da para provar que o
// resultado nao depende do fuso da maquina trocando-o dentro do teste.
const FUSO_ORIGINAL = process.env.TZ;
const FUSOS = [
  'UTC',
  'America/Sao_Paulo',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Pacific/Kiritimati',
];

function emCadaFuso(verificar: () => void) {
  for (const fuso of FUSOS) {
    process.env.TZ = fuso;
    verificar();
  }
}

afterEach(() => {
  process.env.TZ = FUSO_ORIGINAL;
});

describe('a suite roda no fuso da operacao', () => {
  it('TZ=America/Sao_Paulo vem do vitest.config', () => {
    expect(FUSO_ORIGINAL).toBe('America/Sao_Paulo');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Sao_Paulo');
  });
});

describe('formatDate — data de calendario', () => {
  it("'2026-08-07' e 07/08/2026 em qualquer fuso (o ETD do PK219)", () => {
    emCadaFuso(() => expect(formatDate('2026-08-07')).toBe('07/08/2026'));
  });

  it('coluna date serializada como meia-noite UTC tambem nao desloca o dia', () => {
    emCadaFuso(() => {
      expect(formatDate('2026-08-07T00:00:00.000Z')).toBe('07/08/2026');
      expect(formatDate('2026-08-07T00:00:00Z')).toBe('07/08/2026');
    });
  });

  it('contraprova: o formatador antigo mostrava 06/08 em Brasilia', () => {
    process.env.TZ = 'America/Sao_Paulo';
    const antigo = new Date('2026-08-07').toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    expect(antigo).toBe('06/08/2026');
  });

  it('virada de ano e 29/02 de ano bissexto', () => {
    emCadaFuso(() => {
      expect(formatDate('2026-01-01')).toBe('01/01/2026');
      expect(formatDate('2026-12-31')).toBe('31/12/2026');
      expect(formatDate('2028-02-29')).toBe('29/02/2028');
    });
  });

  it('formatDateOnly continua existindo e usa o mesmo formatador', () => {
    expect(formatDateOnly('2027-07-24')).toBe('24/07/2027');
    expect(formatDateOnly('2026-08-07T00:00:00.000Z')).toBe('07/08/2026');
  });
});

describe('formatDate — instante real no fuso America/Sao_Paulo', () => {
  it('02:30 UTC ainda e o dia anterior em Brasilia', () => {
    emCadaFuso(() => expect(formatDate('2026-09-11T02:30:00.000Z')).toBe('10/09/2026'));
  });

  it('03:00 UTC ja e o dia seguinte em Brasilia (inicio do dia local)', () => {
    emCadaFuso(() => expect(formatDate('2026-09-04T03:00:00.000Z')).toBe('04/09/2026'));
  });

  it('23:59 de Brasilia continua no mesmo dia', () => {
    emCadaFuso(() => expect(formatDate('2026-09-11T23:59:00-03:00')).toBe('11/09/2026'));
  });

  it('aceita objeto Date', () => {
    emCadaFuso(() => expect(formatDate(new Date('2026-09-11T02:30:00.000Z'))).toBe('10/09/2026'));
  });
});

describe('formatDateTime', () => {
  it('formata no fuso da operacao, nao no da maquina', () => {
    emCadaFuso(() => {
      expect(formatDateTime('2026-09-11T02:30:00.000Z')).toBe('10/09/2026, 23:30');
      expect(formatDateTime('2026-09-11T13:13:00.000Z')).toBe('11/09/2026, 10:13');
    });
  });

  it('meia-noite UTC e um instante real aqui: 21:00 do dia anterior', () => {
    emCadaFuso(() => expect(formatDateTime('2026-09-11T00:00:00.000Z')).toBe('10/09/2026, 21:00'));
  });

  it('data de calendario pura sai sem hora inventada', () => {
    emCadaFuso(() => expect(formatDateTime('2026-08-07')).toBe('07/08/2026'));
  });
});

describe('valor ausente ou invalido vira "-"', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['vazio', ''],
    ['espacos', '   '],
    ['texto', 'nao e data'],
    ['dia inexistente', '2026-02-30'],
    ['mes inexistente', '2026-13-01'],
    ['Date invalida', new Date('x')],
  ])('%s', (_nome, valor) => {
    expect(formatDate(valor)).toBe('-');
    expect(formatDateTime(valor)).toBe('-');
    expect(formatDateOnly(valor)).toBe('-');
  });
});

describe('relativeTime', () => {
  it('cai no formatDateTime para datas antigas', () => {
    expect(relativeTime('2020-01-01T15:00:00.000Z')).toBe('01/01/2020, 12:00');
  });
});
