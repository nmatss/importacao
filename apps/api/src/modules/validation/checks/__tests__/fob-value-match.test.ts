import { describe, it, expect } from 'vitest';
import fobCalculation from '../fob-calculation.js';

describe('fob-calculation check', () => {
  it('should pass when items sum matches total FOB value', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 1000,
        items: [
          { unitPrice: 10, quantity: 50 },
          { unitPrice: 20, quantity: 25 },
        ],
      },
    });
    expect(result.status).toBe('passed');
    expect(result.checkName).toBe('fob-calculation');
  });

  it('should fail when items sum does not match total FOB', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 5000,
        items: [
          { unitPrice: 10, quantity: 50 },
          { unitPrice: 20, quantity: 25 },
        ],
      },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Divergencia');
  });

  it('should warn when no items found', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 1000,
        items: [],
      },
    });
    expect(result.status).toBe('warning');
  });

  it('should warn when no total FOB value', () => {
    const result = fobCalculation({
      invoiceData: {
        items: [{ unitPrice: 10, quantity: 5 }],
      },
    });
    expect(result.status).toBe('warning');
  });

  it('should skip when invoice data is missing', () => {
    const result = fobCalculation({});
    expect(result.status).toBe('skipped');
  });

  it('should pass within proportional tolerance for large values', () => {
    // 0.1% of 100000 = 100 tolerance
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 100000,
        items: [
          { unitPrice: 99.95, quantity: 1000 },
          { unitPrice: 0.01, quantity: 5000 },
        ],
      },
    });
    // 99950 + 50 = 100000, exact match
    expect(result.status).toBe('passed');
  });

  it('should warn when FOC/discount explains the invoice item sum difference', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 24312.52,
        items: [
          { unitPrice: 24312.52, quantity: 1, totalPrice: 24312.52 },
          { description: 'FREE OF CHARGE DISCOUNT', unitPrice: 266.4, quantity: 1, totalPrice: 0 },
        ],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.actualValue).toBe('24578.92');
    expect(result.expectedValue).toBe('24312.52');
    expect(result.message).toContain(
      'Diferença explicada por item FOC/desconto identificado na Invoice',
    );
  });

  it('should warn when explicit FOC has a positive declared total but is excluded from FOB', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 1020,
        items: [
          { unitPrice: 8.5, quantity: 120, totalPrice: 1020 },
          { isFreeOfCharge: true, quantity: 1, totalPrice: 266.4 },
        ],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.expectedValue).toBe('1020.00');
    expect(result.actualValue).toBe('1286.40');
  });

  it('should warn when a negative discount line reconciles the declared FOB', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 24312.52,
        items: [
          { description: 'COMMERCIAL GOODS', quantity: 1, totalPrice: 24578.92 },
          { description: 'DESCONTO COMERCIAL', quantity: 1, totalPrice: -266.4 },
        ],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.expectedValue).toBe('24312.52');
    expect(result.actualValue).toBe('24578.92');
    expect(result.message).toContain('Total ajustado = 24312.52');
  });

  it('should identify FOC markers in alternate text fields and zero unit price', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 1020,
        items: [
          { unitPrice: 8.5, quantity: 120, totalPrice: 1020 },
          { descricao: 'AMOSTRA SEM VALOR COMERCIAL', unitPrice: 0, quantity: 3, totalPrice: 0 },
        ],
      },
    });

    expect(result.status).toBe('passed');
    expect(result.message).toContain('FOC');
  });

  it('does not silently drop a zero-priced item without an FOC marker', () => {
    // `hasZeroPrice` classificava como FOC e removia do somatorio: se a
    // extracao devolveu 0 em vez de ausente, o item comercial sumia e o FOB
    // "conferia".
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 1020,
        items: [
          { itemCode: 'PI7752Y', unitPrice: 8.5, quantity: 120, totalPrice: 1020 },
          { itemCode: 'PI7753Y', unitPrice: 0, quantity: 50, totalPrice: 0 },
        ],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('sem preco extraido e sem marcador de FOC');
    expect(result.message).toContain('PI7753Y');
  });

  it('keeps excluding items with an explicit FOC marker', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 1020,
        items: [
          { unitPrice: 8.5, quantity: 120, totalPrice: 1020 },
          { isFreeOfCharge: true, unitPrice: 0, quantity: 50, totalPrice: 0 },
        ],
      },
    });

    expect(result.status).toBe('passed');
    expect(result.message).toContain('FOC');
  });

  it('reads brazilian-formatted amounts', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 'US$ 24.312,52',
        items: [{ quantity: 1, totalPrice: '24.312,52' }],
      },
    });

    expect(result.status).toBe('passed');
  });

  it('does not let a line with no price at all count as zero', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 1020,
        items: [
          { itemCode: 'PI7752Y', unitPrice: 8.5, quantity: 120, totalPrice: 1020 },
          { itemCode: 'PI7799Y', quantity: 30, description: 'CAIXA MASTER' },
        ],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('PI7799Y');
  });

  it('distinguishes a declared zero total from a missing total', () => {
    const result = fobCalculation({
      invoiceData: { totalFobValue: 0, items: [{ unitPrice: 10, quantity: 5 }] },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('declarado na Invoice e 0.00');
  });

  it('should handle null/undefined item fields gracefully', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 0,
        items: [{ unitPrice: null, quantity: undefined }],
      },
    });
    // totalFob is 0 which is falsy -> warning
    expect(result.status).toBe('warning');
  });
});
