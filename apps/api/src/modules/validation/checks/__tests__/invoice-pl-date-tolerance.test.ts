import { describe, expect, it } from 'vitest';
import invoicePlDateTolerance, {
  INVOICE_PL_DATE_TOLERANCE_DAYS,
} from '../invoice-pl-date-tolerance.js';

describe('invoice-pl-date-tolerance check', () => {
  it('passes when Invoice and PL shipment dates are equal', () => {
    const result = invoicePlDateTolerance({
      invoiceData: { shipmentDate: '2026-06-01' },
      packingListData: { shipmentDate: '2026-06-01' },
    });

    expect(result.status).toBe('passed');
    expect(result.documentsCompared).toBe('INV vs PL');
  });

  it('passes when dates differ but stay within tolerance', () => {
    const result = invoicePlDateTolerance({
      invoiceData: { shipmentDate: '2026-06-01' },
      // 20 days apart — under the 30-day tolerance.
      packingListData: { shipmentDate: '2026-06-21' },
    });

    expect(result.status).toBe('passed');
    expect(result.actualValue).toContain('20d');
  });

  it('passes exactly at the tolerance boundary', () => {
    const result = invoicePlDateTolerance({
      invoiceData: { shipmentDate: '2026-06-01' },
      packingListData: { shipmentDate: '2026-07-01' }, // 30 days
    });

    expect(result.status).toBe('passed');
  });

  it('warns when dates are very divergent (beyond tolerance)', () => {
    const result = invoicePlDateTolerance({
      invoiceData: { shipmentDate: '2026-06-01' },
      // ~45 days apart — beyond the 30-day tolerance.
      packingListData: { shipmentDate: '2026-07-16' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain(String(INVOICE_PL_DATE_TOLERANCE_DAYS));
  });

  it('accepts ETD / shippedOnBoardDate aliases', () => {
    const result = invoicePlDateTolerance({
      invoiceData: { etd: '2026-06-01' },
      packingListData: { shippedOnBoardDate: '2026-06-05' },
    });

    expect(result.status).toBe('passed');
  });

  it('skips when the Invoice date is missing (no false failure)', () => {
    const result = invoicePlDateTolerance({
      invoiceData: { invoiceNumber: 'INV-1' },
      packingListData: { shipmentDate: '2026-06-05' },
    });

    expect(result.status).toBe('skipped');
  });

  it('skips when the Packing List date is missing (no false failure)', () => {
    const result = invoicePlDateTolerance({
      invoiceData: { shipmentDate: '2026-06-05' },
      packingListData: {},
    });

    expect(result.status).toBe('skipped');
  });

  it('falls back to the invoice emission date with a widened tolerance (Eduarda 2026-06-19)', () => {
    const result = invoicePlDateTolerance({
      // Only an emission date — now used as a fallback so the comparison still runs.
      invoiceData: { invoiceDate: '2026-06-01' },
      packingListData: { shipmentDate: '2026-06-05' },
    });

    expect(result.status).toBe('passed');
    expect(result.message).toContain('emissao');
  });

  it('still flags an emission-date comparison only when very divergent', () => {
    const result = invoicePlDateTolerance({
      invoiceData: { invoiceDate: '2026-06-01' },
      // ~70 days apart — beyond the widened 60-day emission tolerance.
      packingListData: { date: '2026-08-10' },
    });

    expect(result.status).toBe('warning');
  });
});
