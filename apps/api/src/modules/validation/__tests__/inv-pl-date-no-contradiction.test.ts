import { describe, it, expect } from 'vitest';
import datesMatch from '../checks/dates-match.js';
import invoicePlDateTolerance, {
  INVOICE_PL_DATE_TOLERANCE_DAYS,
} from '../checks/invoice-pl-date-tolerance.js';

/**
 * P2 contradiction: previously, an INV-vs-PL shipment-date pair diverging by
 * more than the tolerance produced BOTH a dates-match FAIL and an
 * invoice-pl-date-tolerance WARNING for the same pair — two contradictory rows
 * in the panel. The tolerance-aware check now owns the INV-vs-PL pair.
 */
describe('INV vs PL date single source of truth (P2)', () => {
  it('does not double-report the INV-vs-PL pair when only INV and PL are present', () => {
    // 45 days apart — beyond the 30-day tolerance.
    const input = {
      invoiceData: { shipmentDate: '2026-01-01' },
      packingListData: { shipmentDate: '2026-02-15' },
    };

    const tolerance = invoicePlDateTolerance(input);
    const dm = datesMatch(input);

    // Tolerance check is the source of truth for this pair: it WARNs.
    expect(tolerance.status).toBe('warning');

    // dates-match must NOT also fire on the same INV-vs-PL pair.
    expect(dm.status).not.toBe('failed');
    expect(dm.status).not.toBe('warning');
    expect(dm.status).toBe('skipped');
  });

  it('keeps dates-match active for the INV-vs-BL comparison it still owns', () => {
    // INV and PL agree within tolerance; BL is wildly divergent. dates-match
    // must still catch the INV-vs-BL divergence (it defers only INV-vs-PL).
    const input = {
      invoiceData: { shipmentDate: '2026-01-01' },
      packingListData: { shipmentDate: '2026-01-03' },
      blData: { shipmentDate: '2026-06-01' },
    };

    const dm = datesMatch(input);
    expect(dm.status).toBe('failed');
    // PL was deferred to the tolerance check, so it is absent from the panel.
    expect(dm.actualValue).toContain('INV=');
    expect(dm.actualValue).toContain('BL=');
    expect(dm.actualValue).not.toContain('PL=');
    // The reported label must match what was actually compared: PL deferred.
    expect(dm.documentsCompared).toBe('INV vs BL');
    expect(dm.documentsCompared).not.toContain('PL');

    // And the INV-vs-PL pair within tolerance PASSes on the tolerance check.
    expect(invoicePlDateTolerance(input).status).toBe('passed');
  });

  it('still compares PL-vs-BL when the invoice has no shipment date', () => {
    // No INV shipment date → tolerance check skips and dates-match keeps PL.
    const input = {
      invoiceData: { invoiceNumber: 'INV-1' },
      packingListData: { shipmentDate: '2026-01-01' },
      blData: { shipmentDate: '2026-01-03' },
    };

    expect(invoicePlDateTolerance(input).status).toBe('skipped');
    const dm = datesMatch(input);
    expect(dm.actualValue).toContain('PL=');
    expect(dm.actualValue).toContain('BL=');
    expect(dm.status).toBe('passed');
  });

  it('tolerance boundary stays within the tolerance check only', () => {
    expect(INVOICE_PL_DATE_TOLERANCE_DAYS).toBe(30);
    const input = {
      invoiceData: { shipmentDate: '2026-01-01' },
      packingListData: { shipmentDate: '2026-01-31' }, // exactly 30 days
    };
    expect(invoicePlDateTolerance(input).status).toBe('passed');
    expect(datesMatch(input).status).toBe('skipped');
  });
});
