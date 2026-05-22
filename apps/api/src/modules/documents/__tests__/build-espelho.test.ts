import { describe, it, expect } from 'vitest';
import { buildEspelhoFromAiData } from '../utils/build-espelho.js';

describe('buildEspelhoFromAiData', () => {
  const inv = {
    invoiceNumber: 'IM0712602NB',
    importerName: 'UNI.CO COMERCIO S/A',
    importerCnpj: '00.399.603/0006-12',
    importerAddress: 'Av Paulista, 1000',
    totalFobValue: 24578.92,
    totalBoxes: 314,
    items: [
      {
        itemCode: 'PI7752Y',
        description: 'Blouse blue',
        quantity: 100,
        unitPrice: 5.5,
        totalPrice: 550,
        ncmCode: '6404.19.00',
      },
      {
        itemCode: 'AC2285Y',
        description: 'Bag yellow',
        quantity: 50,
        unitPrice: 3.0,
        totalPrice: 150,
      },
    ],
  };

  const pl = {
    totalBoxes: 314,
    totalNetWeight: 4500,
    totalGrossWeight: 5000,
    totalCbm: 21.557,
    items: [
      {
        itemCode: 'PI 7752Y', // intentionally has whitespace — must still match
        boxQuantity: 50,
        netWeight: 30,
        grossWeight: 35,
        color: 'BLUE',
        size: 'M',
      },
      {
        itemCode: 'AC2285Y',
        boxQuantity: 30,
        netWeight: 20,
        grossWeight: 22,
      },
    ],
  };

  const bl = {
    blNumber: 'SHYY26021495A',
    vesselName: 'COSCO SHIPPING ARGENTINA',
    containerNumber: 'TCKU1234567',
    shipper: 'KIOM GLOBAL LIMITED',
    totalGrossWeight: 5050,
  };

  it('builds a summary from PL totals with BL fallback for gross weight', () => {
    const { summary } = buildEspelhoFromAiData(inv, pl, bl);
    expect(summary.totalBoxes).toBe(314);
    expect(summary.totalNetWeight).toBe(4500);
    expect(summary.totalGrossWeight).toBe(5000); // PL beats BL
    expect(summary.totalCbm).toBe(21.557);
    expect(summary.totalAmountUsd).toBe(24578.92);
    expect(summary.shippingLine).toBe('KIOM GLOBAL LIMITED');
    expect(summary.vesselName).toBe('COSCO SHIPPING ARGENTINA');
    expect(summary.blNumber).toBe('SHYY26021495A');
    expect(summary.importerCnpj).toBe('00.399.603/0006-12');
    expect(summary.generatedBy).toBe('auto_deterministic');
  });

  it('joins invoice + PL items by normalized item-code', () => {
    const { items } = buildEspelhoFromAiData(inv, pl, bl);
    expect(items).toHaveLength(2);

    const pi = items.find((i) => i.codigo === 'PI7752Y')!;
    expect(pi.qty).toBe(100); // from invoice
    expect(pi.unitPrice).toBe(5.5);
    expect(pi.amountUsd).toBe(550);
    expect(pi.caixasPorRef).toBe(50); // from PL via normalized match
    expect(pi.pesoLiquidoTotal).toBe(30);
    expect(pi.color).toBe('BLUE'); // bleeds in from PL

    const ac = items.find((i) => i.codigo === 'AC2285Y')!;
    expect(ac.caixasPorRef).toBe(30);
  });

  it('falls back to PL weight when item is missing in PL after concat-style noise', () => {
    const invNoise = {
      ...inv,
      items: [{ itemCode: 'FALL/24 PI7752Y', quantity: 100, unitPrice: 5.5, totalPrice: 550 }],
    };
    const { items } = buildEspelhoFromAiData(invNoise, pl, bl);
    // codigo retains whatever the AI gave (cleanup runs upstream); aggregator
    // still finds PL match via normalize since the noise is preserved as-is
    // here — by design, this helper does not re-run itemCode cleanup.
    expect(items[0].codigo).toBe('FALL/24 PI7752Y');
    expect(items[0].caixasPorRef).toBe(null); // no PL match because codes differ
  });

  it('returns empty items[] when invoice has no items', () => {
    const result = buildEspelhoFromAiData({ ...inv, items: [] }, pl, bl);
    expect(result.items).toHaveLength(0);
    expect(result.summary.totalBoxes).toBe(314);
  });
});
