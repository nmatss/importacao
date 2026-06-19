import { describe, expect, it } from 'vitest';
import certificateCompleteness from '../certificate-completeness.js';

describe('certificate-completeness check', () => {
  it('skips when invoice is absent because certification need is unknown', () => {
    const result = certificateCompleteness({
      processData: { hasCertification: false },
    });

    expect(result.status).toBe('skipped');
    expect(result.message).toContain('Invoice ausente');
  });

  it('warns when invoice has no items and certification is not explicitly required', () => {
    const result = certificateCompleteness({
      invoiceData: { items: [] },
      processData: { hasCertification: false },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao pode ser confirmado');
  });

  it('fails when process requires certification but no certificate exists', () => {
    const result = certificateCompleteness({
      invoiceData: { items: [{ itemCode: 'A1' }] },
      processData: { hasCertification: true },
    });

    expect(result.status).toBe('failed');
    expect(result.actualValue).toContain('Nenhum certificado');
  });
});
