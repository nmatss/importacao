import { describe, expect, it } from 'vitest';
import dateSequenceCheck from '../date-sequence-check.js';

describe('dateSequenceCheck', () => {
  it('trata ETD historica como aviso, nao como falha de dado', () => {
    const result = dateSequenceCheck({
      processData: {
        status: 'completed',
        etd: '2025-05-01',
        eta: '2025-06-01',
        shipmentDate: '2025-05-02',
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao prova divergencia');
  });

  it('mantem inversao cronologica como falha', () => {
    const result = dateSequenceCheck({
      invoiceData: { invoiceDate: '2026-04-10' },
      processData: { shipmentDate: '2026-04-01', eta: '2026-05-01' },
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('posterior a data de embarque');
  });
});
