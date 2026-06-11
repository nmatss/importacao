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
      items: [{ itemCode: { value: 'ABC123', confidence: 1 } }],
    });
    expect(flat.invoiceNumber).toBe('INV-1');
    expect(flat.items[0].itemCode).toBe('ABC123');
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
