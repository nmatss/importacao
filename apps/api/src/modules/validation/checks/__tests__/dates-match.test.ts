import { describe, expect, it } from 'vitest';
import datesMatch from '../dates-match.js';

describe('dates-match check', () => {
  it('passes when INV, PL and BL dates are inside operational tolerance', () => {
    const result = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      packingListData: { shipmentDate: '2026-06-05' },
      blData: { shippedOnBoardDate: '2026-06-08' },
    });

    expect(result.status).toBe('passed');
    expect(result.documentsCompared).toBe('INV vs PL vs BL');
  });

  it('warns for small date differences and fails only for relevant divergence', () => {
    const warning = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      packingListData: { shipmentDate: '2026-06-20' },
      blData: { shippedOnBoardDate: '2026-06-21' },
    });
    expect(warning.status).toBe('warning');

    const failed = datesMatch({
      invoiceData: { invoiceDate: '2026-06-01' },
      packingListData: { shipmentDate: '2026-07-15' },
      blData: { shippedOnBoardDate: '2026-07-16' },
    });
    expect(failed.status).toBe('failed');
  });
});
