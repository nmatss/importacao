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

  it('reads brazilian-formatted totals instead of treating them as zero', () => {
    // `Number("1.150,00")` era NaN e `Number(x ?? 0)` empurrava peso ilegivel
    // para 0, fazendo o check dizer que nao havia dado de peso.
    const result = weightRatioCheck({
      packingListData: { totalGrossWeight: '1.150,00', totalNetWeight: '1.000,00' },
    });

    expect(result.status).toBe('passed');
  });

  it('says the weight is unreadable instead of saying there is no weight data', () => {
    const result = weightRatioCheck({
      packingListData: { totalGrossWeight: 'N/A', totalNetWeight: 'N/D' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao interpretavel');
    expect(result.message).not.toContain('Nenhum dado de peso encontrado');
  });

  it('reports items whose weights are present but unreadable', () => {
    const result = weightRatioCheck({
      packingListData: {
        totalGrossWeight: 115,
        totalNetWeight: 100,
        items: [{ itemCode: 'A1', grossWeight: '1.234', netWeight: 100 }],
      },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao interpretavel');
  });
});
