import { describe, it, expect, vi } from 'vitest';

// flattenAiData is pure, but it lives in service.ts whose import chain bootstraps
// drizzle. Mock the DB connection (and the alert side-effect) so the import does
// not require DATABASE_URL — same pattern as extract-with-upgrade.test.ts.
vi.mock('../../../shared/database/connection.js', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() },
}));
vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

import { flattenAiData } from '../service.js';

describe('flattenAiData', () => {
  it('unwraps confidence fields and item arrays', () => {
    const flat = flattenAiData({
      invoiceNumber: { value: 'INV-1', confidence: 0.9 },
      items: [
        {
          itemCode: { value: 'ABC123', confidence: 1 },
          isFreeOfCharge: { value: true, confidence: 0.9 },
        },
      ],
    });
    expect(flat.invoiceNumber).toBe('INV-1');
    expect(flat.items[0].itemCode).toBe('ABC123');
    expect(flat.items[0].isFreeOfCharge).toBe(true);
  });

  it('unwraps confidence fields nested inside objects (e.g. paymentTerms)', () => {
    const flat = flattenAiData({
      paymentTerms: {
        depositPercent: { value: 30, confidence: 0.8 },
        balancePercent: { value: 70, confidence: 0.8 },
        description: { value: '30% deposit / 70% balance', confidence: 0.7 },
      },
    });
    expect(flat.paymentTerms).toEqual({
      depositPercent: 30,
      balancePercent: 70,
      description: '30% deposit / 70% balance',
    });
  });

  it('unwraps a confidence field whose value is an array (e.g. ncmList)', () => {
    const flat = flattenAiData({
      ncmList: { value: ['6115.95.00', '9503.00.99'], confidence: 0.85 },
    });
    expect(flat.ncmList).toEqual(['6115.95.00', '9503.00.99']);
  });

  it('drops harness meta (_trust and any _-prefixed key) so it never reaches validation/UI', () => {
    const flat = flattenAiData({
      invoiceNumber: { value: 'INV-1', confidence: 0.9 },
      _trust: { trust: 'review', findings: [{ field: 'x' }] },
    });
    expect('_trust' in flat).toBe(false);
    expect(flat.invoiceNumber).toBe('INV-1');
  });
});
