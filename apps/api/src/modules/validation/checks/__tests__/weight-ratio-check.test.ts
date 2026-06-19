import { describe, expect, it } from 'vitest';
import weightRatioCheck from '../weight-ratio-check.js';

describe('weight-ratio-check', () => {
  it('warns when items exist but no valid gross/net pair can be validated', () => {
    const result = weightRatioCheck({
      packingListData: {
        items: [
          { itemCode: 'A1', grossWeight: null, netWeight: null },
          { itemCode: 'A2', grossWeight: 0, netWeight: 10 },
        ],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nenhum par de peso bruto e liquido valido');
  });

  it('passes when total gross/net pair is inside the accepted range', () => {
    const result = weightRatioCheck({
      packingListData: {
        totalGrossWeight: 115,
        totalNetWeight: 100,
      },
    });

    expect(result.status).toBe('passed');
  });
});
