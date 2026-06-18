import { describe, expect, it } from 'vitest';

import unitTypeValidation from '../unit-type-validation.js';

describe('unitTypeValidation', () => {
  it('accepts PC/PCS as unit aliases for ordinary unit products', () => {
    const result = unitTypeValidation({
      invoiceData: {
        items: [
          {
            itemCode: 'PI7765Y',
            description: 'LANTERNA DE LED',
            unit: 'PC',
          },
        ],
      },
      packingListData: {
        items: [
          {
            itemCode: 'PI7765Y',
            description: 'LANTERNA DE LED',
            unit: 'PCS',
          },
        ],
      },
    });

    expect(result.status).toBe('passed');
  });

  it('keeps pair and set validation strict when the description requires it', () => {
    const result = unitTypeValidation({
      invoiceData: {
        items: [
          {
            itemCode: 'PI7795Y',
            description: 'KIT COM 4 PECAS',
            unit: 'PC',
          },
        ],
      },
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('esperado SET');
  });
});
