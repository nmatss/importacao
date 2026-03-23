import { describe, it, expect } from 'vitest';
import grossWeightMatch from '../gross-weight-match.js';

describe('gross-weight-match check', () => {
  it('should pass when gross weights match across INV and PL', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 200, totalNetWeight: 180 },
      packingListData: { totalGrossWeight: 200.3 },
    });
    expect(result.status).toBe('passed');
    expect(result.checkName).toBe('gross-weight-match');
  });

  it('should pass when gross weights match across INV, PL, and BL', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 500, totalNetWeight: 450 },
      packingListData: { totalGrossWeight: 500.2 },
      blData: { totalGrossWeight: 500.4 },
    });
    expect(result.status).toBe('passed');
  });

  it('should fail when gross weights differ beyond tolerance', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 200, totalNetWeight: 180 },
      packingListData: { totalGrossWeight: 210 },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Divergencia');
  });

  it('should fail when gross weight is less than net weight', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 100, totalNetWeight: 150 },
      packingListData: { totalGrossWeight: 100 },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('nao e maior que o peso liquido');
  });

  it('should warn when less than 2 documents have gross weight', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 200 },
    });
    expect(result.status).toBe('warning');
    expect(result.message).toContain('insuficientes');
  });

  it('should warn when no data provided', () => {
    const result = grossWeightMatch({});
    expect(result.status).toBe('warning');
  });

  it('should handle NaN values by excluding them', () => {
    const result = grossWeightMatch({
      invoiceData: { totalGrossWeight: 'abc' },
      packingListData: { totalGrossWeight: 200 },
    });
    expect(result.status).toBe('warning');
  });
});
