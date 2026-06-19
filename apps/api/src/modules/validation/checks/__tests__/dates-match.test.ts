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
    // INV shipment date is present, so the INV-vs-PL pair is deferred to the
    // tolerance check and PL is dropped here. The reported label must reflect
    // what was actually compared (INV vs BL), not the full set.
    expect(result.documentsCompared).toBe('INV vs BL');
    expect(result.documentsCompared).not.toContain('PL');
  });

  it('does not compare invoice issue date as ETD or shipment date', () => {
    const result = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      packingListData: { shipmentDate: '20/06/2026' },
      blData: { shippedOnBoardDate: '2026-06-21' },
    });

    expect(result.status).toBe('passed');
    expect(result.actualValue).toBe('PL=2026-06-20; BL=2026-06-21');
    expect(result.message).toContain('invoice nao foi usada');
  });

  it('skips when only one document has a shipment date', () => {
    const result = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      blData: { shippedOnBoardDate: '2026-06-21' },
    });

    expect(result.status).toBe('skipped');
    expect(result.message).toContain('apenas em BL');
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
