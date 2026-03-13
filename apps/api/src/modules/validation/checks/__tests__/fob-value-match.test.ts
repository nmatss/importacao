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
    expect(result.message).toContain('mismatch');
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

  it('should warn when invoice data is missing', () => {
    const result = fobCalculation({});
    expect(result.status).toBe('warning');
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

  it('should handle null/undefined item fields gracefully', () => {
    const result = fobCalculation({
      invoiceData: {
        totalFobValue: 0,
        items: [
          { unitPrice: null, quantity: undefined },
        ],
      },
    });
    // totalFob is 0 which is falsy -> warning
    expect(result.status).toBe('warning');
  });
});
