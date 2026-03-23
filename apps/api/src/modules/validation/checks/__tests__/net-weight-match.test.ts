import { describe, it, expect } from 'vitest';
import netWeightMatch from '../net-weight-match.js';

describe('net-weight-match check', () => {
  it('should pass when net weights match within tolerance', () => {
    const result = netWeightMatch({
      invoiceData: { totalNetWeight: 100.5 },
      packingListData: { totalNetWeight: 100.7 },
    });
    expect(result.status).toBe('passed');
    expect(result.checkName).toBe('net-weight-match');
    expect(result.documentsCompared).toBe('INV vs PL');
  });

  it('should fail when net weights differ beyond tolerance', () => {
    const result = netWeightMatch({
      invoiceData: { totalNetWeight: 100 },
      packingListData: { totalNetWeight: 105 },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Divergencia');
  });

  it('should warn when neither document has net weight', () => {
    const result = netWeightMatch({
      invoiceData: {},
      packingListData: {},
    });
    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao encontrado');
  });

  it('should warn when only one document has net weight', () => {
    const result = netWeightMatch({
      invoiceData: { totalNetWeight: 100 },
      packingListData: {},
    });
    expect(result.status).toBe('warning');
    expect(result.message).toContain('apenas um documento');
  });

  it('should handle missing input gracefully', () => {
    const result = netWeightMatch({});
    expect(result.status).toBe('warning');
  });

  it('should pass when weights are exactly equal', () => {
    const result = netWeightMatch({
      invoiceData: { totalNetWeight: 250.123 },
      packingListData: { totalNetWeight: 250.123 },
    });
    expect(result.status).toBe('passed');
  });

  it('should pass at the boundary of tolerance (0.5 kg)', () => {
    const result = netWeightMatch({
      invoiceData: { totalNetWeight: 100 },
      packingListData: { totalNetWeight: 100.5 },
    });
    expect(result.status).toBe('passed');
  });

  it('should fail just beyond tolerance', () => {
    const result = netWeightMatch({
      invoiceData: { totalNetWeight: 100 },
      packingListData: { totalNetWeight: 100.51 },
    });
    expect(result.status).toBe('failed');
  });
});
