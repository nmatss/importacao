import { describe, expect, it } from 'vitest';

import invoiceValueVsFup from '../invoice-value-vs-fup.js';
import freightVsFup from '../freight-vs-fup.js';
import freightValueMatch from '../freight-value-match.js';
import cbmVsFup from '../cbm-vs-fup.js';

describe('invoice-value-vs-fup', () => {
  it('compares normally when the invoice is in USD (same currency as the system)', () => {
    const result = invoiceValueVsFup({
      invoiceData: { totalFobValue: 1160, currency: 'US$' },
      processData: { totalFobValue: '1160.00' },
    });

    expect(result.status).toBe('passed');
  });

  it('fails a real divergence when both currencies are confirmed', () => {
    const result = invoiceValueVsFup({
      invoiceData: { totalFobValue: 1200, currency: 'USD' },
      processData: { totalFobValue: '1160.00' },
    });

    expect(result.status).toBe('failed');
  });

  it('does not compare values across different currencies', () => {
    // Uma invoice em EUR gerava um `failed` de moeda E um `failed` de valor,
    // comparando EUR contra o FOB do sistema, que esta em USD.
    const result = invoiceValueVsFup({
      invoiceData: { totalFobValue: 1160, currency: 'EUR' },
      processData: { totalFobValue: '1160.00' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('Moedas diferentes');
    expect(result.message).toContain('nao realizada');
  });

  it('downgrades to warning when the invoice currency was not extracted', () => {
    const result = invoiceValueVsFup({
      invoiceData: { totalFobValue: 1200 },
      processData: { totalFobValue: '1160.00' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('moeda nao confirmada');
  });

  it('reads a brazilian-formatted invoice total', () => {
    const result = invoiceValueVsFup({
      invoiceData: { totalFobValue: 'US$ 24.312,52', currency: 'USD' },
      processData: { totalFobValue: '24312.52' },
    });

    expect(result.status).toBe('passed');
  });

  it('says the invoice total is unreadable instead of saying it is missing', () => {
    const result = invoiceValueVsFup({
      invoiceData: { totalFobValue: 'a definir', currency: 'USD' },
      processData: { totalFobValue: '24312.52' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao pode ser interpretado');
    expect(result.message).not.toContain('nao encontrado');
  });
});

describe('freight-vs-fup', () => {
  it('fails a divergence when the BL states the same currency as the system', () => {
    const result = freightVsFup({
      blData: { freightValue: 300, freightCurrency: 'USD' },
      processData: { freightValue: '250.00' },
    });

    expect(result.status).toBe('failed');
  });

  it('does not compare a EUR freight against the USD system value', () => {
    const result = freightVsFup({
      blData: { freightValue: 250, freightCurrency: 'EUR' },
      processData: { freightValue: '250.00' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('Moedas diferentes');
  });

  it('treats PREPAID/COLLECT as an unconfirmed currency, not as a verdict', () => {
    const result = freightVsFup({
      blData: { freightValue: 300, freightCurrency: 'PREPAID' },
      processData: { freightValue: '250.00' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('moeda nao confirmada');
  });
});

describe('freight-value-match', () => {
  it('reports the follow-up freight as absent, not as unreadable', () => {
    const result = freightValueMatch({ blData: { freightValue: 250 } });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('Nenhum valor de frete disponivel');
  });

  it('never emits failed while the currency of both sides is unconfirmed', () => {
    const result = freightValueMatch({
      blData: { freightValue: 300 },
      followUpData: { freightValue: '250.00' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('moeda nao confirmada');
  });
});

describe('cbm-vs-fup', () => {
  it('does not read the Postgres numeric "12.345" as twelve thousand', () => {
    // processData vem de numeric(10,3): o ponto ali e sempre decimal.
    const result = cbmVsFup({
      blData: { totalCbm: 12.345 },
      processData: { totalCbm: '12.345' },
    });

    expect(result.status).toBe('passed');
  });

  it('does not compare a BL volume declared in cubic feet', () => {
    const result = cbmVsFup({
      blData: { totalCbm: '450 CFT' },
      processData: { totalCbm: '12.740' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('unidade');
  });
});
