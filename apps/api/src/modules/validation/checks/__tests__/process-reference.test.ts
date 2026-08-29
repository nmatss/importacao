import { describe, expect, it } from 'vitest';

import processReference from '../process-reference.js';

describe('process-reference', () => {
  it('passes and records the reference source when every document agrees', () => {
    const result = processReference({
      invoiceData: { invoiceNumber: 'PO-2026-7752' },
      packingListData: { packingListNumber: 'po 2026 7752' },
    });

    expect(result.status).toBe('passed');
    expect(result.expectedValue).toContain('fonte: INV');
  });

  it('uses the Invoice as reference even when only PL and BL were extracted first', () => {
    const result = processReference({
      packingListData: { packingListNumber: 'PO-2026-0001' },
      blData: { customerReference: 'PO-2026-9999' },
      invoiceData: { invoiceNumber: 'PO-2026-7752' },
    });

    expect(result.status).toBe('failed');
    expect(result.expectedValue).toContain('fonte: INV');
    expect(result.actualValue).toContain('PL=');
    expect(result.actualValue).toContain('BL=');
  });
});
