import { describe, expect, it } from 'vitest';

import itemLevelMatch from '../item-level-match.js';

describe('itemLevelMatch', () => {
  it('matches invoice items with packing-list FAT prefixes', () => {
    const result = itemLevelMatch({
      invoiceData: {
        items: [
          {
            itemCode: 'PI7765Y',
            quantity: 100,
            description: 'LANTERNA DE LED',
          },
        ],
      },
      packingListData: {
        items: [
          {
            itemCode: 'FAT03PI7765Y',
            quantity: 100,
            description: 'LANTERNA DE LED',
          },
        ],
      },
    });

    expect(result.status).toBe('passed');
    expect(result.message).toContain('Todos os 1 itens');
  });
});
