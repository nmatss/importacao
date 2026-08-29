import { describe, it, expect } from 'vitest';
import portsMatch from '../ports-match.js';

describe('ports-match check', () => {
  it('should pass when ports match between INV and BL', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'Shanghai', portOfDischarge: 'Santos' },
      blData: { portOfLoading: 'Shanghai', portOfDischarge: 'Santos' },
    });
    expect(result.status).toBe('passed');
    expect(result.checkName).toBe('ports-match');
    expect(result.documentsCompared).toBe('INV vs PL vs BL');
  });

  it('should pass with case-insensitive matching', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'SHANGHAI', portOfDischarge: 'SANTOS' },
      blData: { portOfLoading: 'shanghai', portOfDischarge: 'santos' },
    });
    expect(result.status).toBe('passed');
  });

  it('should fail when port of loading differs', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'Shanghai', portOfDischarge: 'Santos' },
      blData: { portOfLoading: 'Ningbo', portOfDischarge: 'Santos' },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Porto de embarque');
  });

  it('should fail when port of discharge differs', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'Shanghai', portOfDischarge: 'Santos' },
      blData: { portOfLoading: 'Shanghai', portOfDischarge: 'Paranagua' },
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Porto de descarga');
  });

  it('should warn when no ports found in either document', () => {
    const result = portsMatch({
      invoiceData: {},
      blData: {},
    });
    expect(result.status).toBe('warning');
  });

  it('should pass when one document has complete ports and the other does not', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'Shanghai', portOfDischarge: 'Santos' },
      blData: {},
    });
    // Only INV has port, BL is empty, so no mismatch occurs
    expect(result.status).toBe('passed');
  });

  it('should warn when discharge port is missing from every document', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'Shanghai' },
      blData: { portOfLoading: 'Shanghai' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('Porto de descarga nao encontrado');
  });

  it('should compare PL and BL when invoice ports are empty', () => {
    const result = portsMatch({
      invoiceData: {},
      packingListData: { portOfLoading: 'NINGBO', portOfDischarge: 'ITAPOA' },
      blData: { portOfLoading: 'SHANGHAI', portOfDischarge: 'ITAPOA' },
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('Porto de embarque');
  });

  it('should skip when invoice data is missing', () => {
    const result = portsMatch({});
    expect(result.status).toBe('skipped');
  });

  it('should handle whitespace in port names', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: '  Shanghai  ', portOfDischarge: '  Santos  ' },
      blData: { portOfLoading: 'Shanghai', portOfDischarge: 'Santos' },
    });
    expect(result.status).toBe('passed');
  });

  it('takes the BL as the declared port reference and records it', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'Ningbo', portOfDischarge: 'Itapoa' },
      blData: { portOfLoading: 'Shanghai', portOfDischarge: 'Itapoa' },
    });

    expect(result.status).toBe('failed');
    expect(result.expectedValue).toContain('Loading: shanghai (fonte: BL)');
    expect(result.message).toContain('Porto de embarque: BL="Shanghai"');
  });

  it('should normalize country suffixes across INV, PL and BL', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'NINGBO', portOfDischarge: 'ITAPOA' },
      packingListData: { portOfLoading: 'NINGBO, CHINA', portOfDischarge: 'ITAPOA, BRAZIL' },
      blData: { portOfLoading: 'Ningbo China', portOfDischarge: 'Itapoa Brazil' },
    });

    expect(result.status).toBe('passed');
  });
});
