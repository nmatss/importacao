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
    expect(result.documentsCompared).toBe('INV vs BL');
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

  it('should pass when one document has ports and the other does not', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: 'Shanghai' },
      blData: {},
    });
    // Only INV has port, BL is empty, so no mismatch occurs
    expect(result.status).toBe('passed');
  });

  it('should handle missing input data', () => {
    const result = portsMatch({});
    expect(result.status).toBe('warning');
  });

  it('should handle whitespace in port names', () => {
    const result = portsMatch({
      invoiceData: { portOfLoading: '  Shanghai  ', portOfDischarge: '  Santos  ' },
      blData: { portOfLoading: 'Shanghai', portOfDischarge: 'Santos' },
    });
    expect(result.status).toBe('passed');
  });
});
