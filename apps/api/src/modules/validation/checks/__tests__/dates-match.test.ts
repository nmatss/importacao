import { describe, expect, it } from 'vitest';
import datesMatch from '../dates-match.js';

describe('dates-match check', () => {
  it('passes when INV, PL and BL dates are inside operational tolerance', () => {
    const result = datesMatch({
      invoiceData: { shipmentDate: '2026-06-01', invoiceDate: '2026-05-30' },
      packingListData: { shipmentDate: '2026-06-05' },
      blData: { shippedOnBoardDate: '2026-06-08' },
    });

    expect(result.status).toBe('passed');
    expect(result.documentsCompared).toBe('INV vs PL vs BL');
  });

  it('falls back to the invoice emission date when no shipment date exists (Eduarda 2026-06-19)', () => {
    const result = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      packingListData: { shipmentDate: '20/06/2026' },
      blData: { shippedOnBoardDate: '2026-06-21' },
    });

    // 20-day spread is within the widened fallback tolerance (30d) -> passed,
    // and the invoice emission date now participates in the comparison.
    expect(result.status).toBe('passed');
    expect(result.actualValue).toBe('INV=2026-06-01; PL=2026-06-20; BL=2026-06-21');
    expect(result.message).toContain('data de emissao');
  });

  it('compares against the invoice emission date even when only the BL has a shipment date', () => {
    const result = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      blData: { shippedOnBoardDate: '2026-06-21' },
    });

    // INV emission (06-01) vs BL on-board (06-21) = 20d, within fallback tolerance.
    expect(result.status).toBe('passed');
    expect(result.actualValue).toBe('INV=2026-06-01; BL=2026-06-21');
  });

  it('flags only a very divergent emission-vs-shipment gap', () => {
    const result = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      blData: { shippedOnBoardDate: '2026-09-01' },
    });

    // ~92 days apart -> beyond the widened 60d warn window -> failed.
    expect(result.status).toBe('failed');
  });

  it('skips when no date of any kind exists in more than one document', () => {
    const result = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      blData: {},
    });

    expect(result.status).toBe('skipped');
    expect(result.message).toContain('apenas em INV');
  });

  it('warns for small shipment date differences and fails only for relevant divergence', () => {
    const warning = datesMatch({
      invoiceData: { shipmentDate: '2026-06-01' },
      packingListData: { shipmentDate: '2026-06-20' },
      blData: { shippedOnBoardDate: '2026-06-21' },
    });
    expect(warning.status).toBe('warning');

    const failed = datesMatch({
      invoiceData: { shipmentDate: '2026-06-01' },
      packingListData: { shipmentDate: '2026-07-15' },
      blData: { shippedOnBoardDate: '2026-07-16' },
    });
    expect(failed.status).toBe('failed');
  });
});
