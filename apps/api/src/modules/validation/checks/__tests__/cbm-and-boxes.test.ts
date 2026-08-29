import { describe, expect, it } from 'vitest';

import boxQuantityMatch from '../box-quantity-match.js';
import cbmMatch from '../cbm-match.js';

describe('cbm-match', () => {
  it('passes when the CBM matches across documents', () => {
    const result = cbmMatch({
      invoiceData: { totalCbm: 2.4 },
      packingListData: { totalCbm: 2.45 },
      blData: { totalCbm: 2.44 },
    });

    expect(result.status).toBe('passed');
  });

  it('reads a brazilian-formatted CBM instead of calling it unavailable', () => {
    const result = cbmMatch({
      packingListData: { totalCbm: '12,45 M3' },
      blData: { totalCbm: 12.45 },
    });

    expect(result.status).toBe('passed');
    expect(result.message).not.toContain('insuficientes');
  });

  it('refuses to guess an ambiguous CBM ("12,450" pode ser 12450 ou 12,45)', () => {
    const result = cbmMatch({
      packingListData: { totalCbm: '12,450' },
      blData: { totalCbm: 12.45 },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('ambiguo');
  });

  it('does not compare a CBM declared in cubic feet against one in m3', () => {
    const result = cbmMatch({
      packingListData: { totalCbm: '450 CFT' },
      blData: { totalCbm: 12.74 },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao comparavel');
  });

  it('uses the Packing List as the declared CBM reference', () => {
    const result = cbmMatch({
      invoiceData: { totalCbm: 2.4 },
      packingListData: { totalCbm: 9.9 },
    });

    expect(result.status).toBe('failed');
    expect(result.expectedValue).toContain('fonte: PL');
  });

  it('does not take blData.totalVolume as if it were cubagem', () => {
    // "volume" no vocabulario de BL/PL brasileiro e quantidade de caixas, nao m3.
    const result = cbmMatch({
      packingListData: { totalCbm: 2.45 },
      blData: { totalVolume: 12 },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('insuficientes');
  });
});

describe('box-quantity-match', () => {
  it('passes when box counts match', () => {
    const result = boxQuantityMatch({
      invoiceData: { totalBoxes: 12 },
      packingListData: { totalBoxes: 12 },
      blData: { totalBoxes: 12 },
    });

    expect(result.status).toBe('passed');
  });

  it('reads a thousand-separated box count instead of dropping it', () => {
    const result = boxQuantityMatch({
      packingListData: { totalBoxes: '1.234.000' },
      blData: { totalBoxes: 1234000 },
    });

    expect(result.status).toBe('passed');
  });

  it('flags decimal box counts as a possible CBM mix-up', () => {
    const result = boxQuantityMatch({
      packingListData: { totalBoxes: 2.44 },
      blData: { totalBoxes: 12 },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('cubagem');
  });

  it('uses the Packing List as the declared box reference', () => {
    const result = boxQuantityMatch({
      invoiceData: { totalBoxes: 10 },
      packingListData: { totalBoxes: 12 },
    });

    expect(result.status).toBe('failed');
    expect(result.expectedValue).toContain('fonte: PL');
    expect(result.message).toContain('referencia: PL');
  });

  it('says the count is unreadable instead of saying the document is missing', () => {
    const result = boxQuantityMatch({
      packingListData: { totalBoxes: 'doze' },
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('nao comparavel');
  });
});
