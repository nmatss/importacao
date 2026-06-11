import { describe, it, expect } from 'vitest';
import {
  NUMERARIO_FACTOR,
  LOW_INVOICE_THRESHOLD_USD,
  INSURANCE_COVERAGE_LIMIT_USD,
  computeCustomsValueUsd,
  computeNumerario,
  isLowInvoice,
  exceedsInsuranceCoverage,
  computeDemurrage,
  buildFinancialSnapshot,
  type FinancialInput,
} from '../calculations.js';

function baseInput(overrides: Partial<FinancialInput> = {}): FinancialInput {
  return {
    fobValueUsd: 100_000,
    freightValueUsd: 5_000,
    insuranceValueUsd: 500,
    exchangeRate: 5.2,
    freeTimeDays: 14,
    dischargeDate: '2026-06-01',
    today: new Date('2026-06-11T12:00:00Z'),
    ...overrides,
  };
}

describe('computeCustomsValueUsd', () => {
  it('soma FOB + frete + seguro', () => {
    expect(computeCustomsValueUsd(100_000, 5_000, 500)).toBe(105_500);
  });

  it('trata frete/seguro ausentes como zero', () => {
    expect(computeCustomsValueUsd(100_000, null, null)).toBe(100_000);
  });

  it('retorna null sem FOB (âncora do cálculo)', () => {
    expect(computeCustomsValueUsd(null, 5_000, 500)).toBeNull();
    expect(computeCustomsValueUsd(0, 5_000, 500)).toBeNull();
  });

  it('arredonda para 2 casas', () => {
    expect(computeCustomsValueUsd(100.111, 0.005, 0)).toBe(100.12);
  });
});

describe('computeNumerario', () => {
  it('numerário = valor aduaneiro × 0,6 e pct = numerário/aduaneiro', () => {
    const result = computeNumerario(548_600); // 105.500 USD × 5,2
    expect(result).not.toBeNull();
    expect(result!.numerarioValue).toBe(329_160);
    expect(result!.numerarioValue).toBeCloseTo(548_600 * NUMERARIO_FACTOR, 2);
    expect(result!.numerarioPct).toBe(0.6);
  });

  it('arredonda numerário para 2 casas e pct para 4 casas', () => {
    const result = computeNumerario(1000.01);
    expect(result!.numerarioValue).toBe(600.01); // 600.006 → 600.01
    expect(result!.numerarioPct).toBe(0.6);
  });

  it('retorna null para aduaneiro zero/negativo/inválido', () => {
    expect(computeNumerario(0)).toBeNull();
    expect(computeNumerario(-10)).toBeNull();
    expect(computeNumerario(NaN)).toBeNull();
  });
});

describe('isLowInvoice (FOB < USD 20.000)', () => {
  it('alerta abaixo do limiar', () => {
    expect(isLowInvoice(19_999.99)).toBe(true);
    expect(isLowInvoice(500)).toBe(true);
  });

  it('não alerta no limiar ou acima', () => {
    expect(isLowInvoice(LOW_INVOICE_THRESHOLD_USD)).toBe(false);
    expect(isLowInvoice(20_000.01)).toBe(false);
  });

  it('não alerta sem FOB ou FOB zero', () => {
    expect(isLowInvoice(null)).toBe(false);
    expect(isLowInvoice(0)).toBe(false);
  });
});

describe('exceedsInsuranceCoverage (> USD 150.000)', () => {
  it('alerta acima do limite de apólice', () => {
    expect(exceedsInsuranceCoverage(150_000.01)).toBe(true);
    expect(exceedsInsuranceCoverage(1_000_000)).toBe(true);
  });

  it('não alerta no limite ou abaixo', () => {
    expect(exceedsInsuranceCoverage(INSURANCE_COVERAGE_LIMIT_USD)).toBe(false);
    expect(exceedsInsuranceCoverage(149_999.99)).toBe(false);
    expect(exceedsInsuranceCoverage(null)).toBe(false);
  });
});

describe('computeDemurrage', () => {
  const today = new Date('2026-06-11T15:30:00Z');

  it('calcula vencimento do free time = descarga + freeTimeDays', () => {
    const result = computeDemurrage('2026-06-01', 14, today);
    expect(result).toEqual({
      freeTimeEndsAt: '2026-06-15',
      daysRemaining: 4,
      status: 'expiring',
    });
  });

  it('status ok quando faltam mais de 7 dias', () => {
    const result = computeDemurrage('2026-06-10', 14, today); // vence 24/06
    expect(result!.daysRemaining).toBe(13);
    expect(result!.status).toBe('ok');
  });

  it('status expiring exatamente no limiar de 7 dias e no dia do vencimento', () => {
    expect(computeDemurrage('2026-06-04', 14, today)!.status).toBe('expiring'); // 7 dias
    const onDueDate = computeDemurrage('2026-05-28', 14, today)!; // vence hoje
    expect(onDueDate.daysRemaining).toBe(0);
    expect(onDueDate.status).toBe('expiring');
  });

  it('status expired com daysRemaining negativo quando vencido', () => {
    const result = computeDemurrage('2026-05-01', 14, today); // venceu 15/05
    expect(result!.daysRemaining).toBe(-27);
    expect(result!.status).toBe('expired');
  });

  it('retorna null sem freeTimeDays ou sem data de descarga', () => {
    expect(computeDemurrage('2026-06-01', null, today)).toBeNull();
    expect(computeDemurrage(null, 14, today)).toBeNull();
    expect(computeDemurrage('2026-06-01', -1, today)).toBeNull();
  });

  it('aceita Date como data de descarga', () => {
    const result = computeDemurrage(new Date('2026-06-01T00:00:00Z'), 7, today);
    expect(result!.freeTimeEndsAt).toBe('2026-06-08');
  });
});

describe('buildFinancialSnapshot', () => {
  it('com taxa USD: valor aduaneiro em BRL e numerário calculados', () => {
    const snapshot = buildFinancialSnapshot(baseInput());

    expect(snapshot.currency).toBe('BRL');
    expect(snapshot.customsValueUsd).toBe(105_500); // 100k + 5k + 500
    expect(snapshot.customsValueBrl).toBe(548_600); // × 5,2
    expect(snapshot.numerario).toEqual({ numerarioValue: 329_160, numerarioPct: 0.6 });
    expect(snapshot.missing).toEqual([]);
  });

  it('sem taxa USD: mantém valores em USD, sem BRL/numerário, com flag', () => {
    const snapshot = buildFinancialSnapshot(baseInput({ exchangeRate: null }));

    expect(snapshot.currency).toBe('USD');
    expect(snapshot.exchangeRate).toBeNull();
    expect(snapshot.customsValueUsd).toBe(105_500);
    expect(snapshot.customsValueBrl).toBeNull();
    expect(snapshot.numerario).toBeNull();
    expect(snapshot.missing).toContain('exchangeRate');
  });

  it('sem FOB: sem aduaneiro nem numerário mesmo com taxa', () => {
    const snapshot = buildFinancialSnapshot(baseInput({ fobValueUsd: null }));

    expect(snapshot.customsValueUsd).toBeNull();
    expect(snapshot.customsValueBrl).toBeNull();
    expect(snapshot.numerario).toBeNull();
    expect(snapshot.missing).toContain('fobValue');
  });

  it('dispara alerta de invoice baixa quando FOB < 20k', () => {
    const snapshot = buildFinancialSnapshot(baseInput({ fobValueUsd: 15_000 }));
    expect(snapshot.alerts.lowInvoice).toBe(true);

    const ok = buildFinancialSnapshot(baseInput({ fobValueUsd: 25_000 }));
    expect(ok.alerts.lowInvoice).toBe(false);
  });

  it('alerta de seguro usa o valor aduaneiro em USD quando disponível', () => {
    // FOB 148k abaixo do limite, mas aduaneiro 148k+5k+500 = 153.5k > 150k
    const snapshot = buildFinancialSnapshot(baseInput({ fobValueUsd: 148_000 }));
    expect(snapshot.alerts.insuranceCoverage).toBe(true);
  });

  it('alerta de seguro cai no FOB quando aduaneiro não é calculável', () => {
    const snapshot = buildFinancialSnapshot(
      baseInput({ fobValueUsd: 200_000, freightValueUsd: null, insuranceValueUsd: null }),
    );
    expect(snapshot.alerts.insuranceCoverage).toBe(true);
    expect(snapshot.missing).toEqual(expect.arrayContaining(['freightValue', 'insuranceValue']));
  });

  it('demurrage null quando faltam freeTimeDays', () => {
    const snapshot = buildFinancialSnapshot(baseInput({ freeTimeDays: null }));
    expect(snapshot.alerts.demurrage).toBeNull();
    expect(snapshot.missing).toContain('freeTimeDays');
  });

  it('demurrage presente quando há descarga + freeTimeDays', () => {
    const snapshot = buildFinancialSnapshot(baseInput());
    expect(snapshot.alerts.demurrage).toEqual({
      freeTimeEndsAt: '2026-06-15',
      daysRemaining: 4,
      status: 'expiring',
    });
  });

  it('taxa zero/negativa é tratada como ausência de taxa', () => {
    const snapshot = buildFinancialSnapshot(baseInput({ exchangeRate: 0 }));
    expect(snapshot.currency).toBe('USD');
    expect(snapshot.numerario).toBeNull();
  });
});
