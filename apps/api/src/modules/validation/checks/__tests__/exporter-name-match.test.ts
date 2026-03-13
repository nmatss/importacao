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
    expect(result.message).toContain('does not match');
  });

  it('should warn on minor punctuation differences', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'ACME Corp.' },
      packingListData: { exporterName: 'ACME Corp' },
    });
    expect(result.status).toBe('warning');
    expect(result.message).toContain('punctuation');
  });

  it('should warn when less than 2 documents have exporter name', () => {
    const result = exporterMatch({
      invoiceData: { exporterName: 'ACME Corp' },
    });
    expect(result.status).toBe('warning');
    expect(result.message).toContain('Not enough documents');
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
