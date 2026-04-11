import { describe, it, expect } from 'vitest';
import exporterMatch from '../exporter-match.js';

describe('exporter-match check', () => {
  it('should pass when exporter names match across documents', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'ACME Corp' },
      packingListData: { exporterName: 'ACME Corp' },
      blData: { shipperName: 'ACME Corp' },
    });
    expect(result.status).toBe('passed');
    expect(result.checkName).toBe('exporter-match');
  });

  it('should pass with case-insensitive matching', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'ACME CORP' },
      packingListData: { exporterName: 'acme corp' },
    });
    expect(result.status).toBe('passed');
  });

  it('should fail when exporter names are significantly different', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'ACME Corp' },
      packingListData: { exporterName: 'Different Company Ltd' },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('não confere');
  });

  it('should pass when only punctuation differs (suffix stripping + fuzzy match)', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'ACME Corp.' },
      packingListData: { exporterName: 'ACME Corp' },
    });
    expect(result.status).toBe('passed');
  });

  it('should pass when BL shipper block embeds address/phone on extra lines', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'KIOM GLOBAL LIMITED' },
      packingListData: { exporterName: 'KIOM GLOBAL LIMITED' },
      blData: {
        shipper:
          'KIOM GLOBAL LIMITED\nROOM E, 10/F, NEW HENNESSY TOWER\n263 HENNESSY ROAD, WANCHAI, HONG KONG\n+86 755 2167 3686',
      },
    });
    expect(result.status).toBe('passed');
    expect(result.documentsCompared).toContain('BL');
  });

  it('should not be "passed" when there is a typo in a company token', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'KIOM GLOBAL LIMITED' },
      packingListData: { exporterName: 'KIOM GLOBEL LIMITED' }, // typo
    });
    expect(['warning', 'failed']).toContain(result.status);
  });

  it('should warn when less than 2 documents have exporter name', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'ACME Corp' },
    });
    expect(result.status).toBe('warning');
    expect(result.message).toContain('insuficientes');
  });

  it('should warn with no input data', () => {
    const result = exporterMatch({});
    expect(result.status).toBe('warning');
  });

  it('should use shipperName from BL data', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'ACME Corp' },
      blData: { shipperName: 'ACME Corp' },
    });
    expect(result.status).toBe('passed');
    expect(result.documentsCompared).toContain('BL');
  });

  it('should handle empty string values as missing', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: '' },
      packingListData: { exporterName: '' },
    });
    expect(result.status).toBe('warning');
  });
});
