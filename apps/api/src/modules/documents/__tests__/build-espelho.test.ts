import { describe, it, expect } from 'vitest';
import { buildEspelhoFromAiData } from '../utils/build-espelho.js';
import { createEanIndex } from '../../espelhos/ean-lookup.js';

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
    expect(summary.exporterName).toBe('KIOM GLOBAL LIMITED');
    expect(summary.shippingLine).toBeNull();
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

  describe('EAN-anchored join (groundwork #9)', () => {
    const emptyIndex = createEanIndex([]);

    it('joins by EAN when both sides have a valid one, even with diverging item codes', () => {
      const invEan = {
        ...inv,
        items: [
          {
            itemCode: '10604232', // INV uses internal code...
            ean: '7909692093303',
            quantity: 100,
            unitPrice: 5.5,
            totalPrice: 550,
          },
        ],
      };
      const plEan = {
        ...pl,
        items: [
          {
            itemCode: 'MEIA-ESPORTE-34-39', // ...PL uses a free-form reference
            ean: '7909 6920 93303', // formatted differently — must still match
            boxQuantity: 77,
            netWeight: 12,
            grossWeight: 14,
          },
        ],
      };
      const { items } = buildEspelhoFromAiData(invEan, plEan, bl, { eanIndex: emptyIndex });
      expect(items[0].caixasPorRef).toBe(77); // joined via EAN, not itemCode
      expect(items[0].pesoLiquidoTotal).toBe(12);
      expect(items[0].ean).toBe('7909692093303');
      expect(items[0].eanSource).toBe('document');
    });

    it('treats an EAN with a bad check digit as absent and falls back to itemCode join', () => {
      const invBad = {
        ...inv,
        items: [
          {
            itemCode: 'PI7752Y',
            ean: '7909692093304', // invalid check digit — must not be used or emitted
            quantity: 100,
            unitPrice: 5.5,
            totalPrice: 550,
          },
        ],
      };
      const { items } = buildEspelhoFromAiData(invBad, pl, bl, { eanIndex: emptyIndex });
      expect(items[0].caixasPorRef).toBe(50); // matched 'PI 7752Y' via normalized code
      expect(items[0].ean).toBe(null);
      expect(items[0].eanSource).toBe(null);
    });

    it('inherits the EAN from the PL side when the invoice has none', () => {
      const plWithEan = {
        ...pl,
        items: [{ ...pl.items[0], ean: '7891276565590' }, pl.items[1]],
      };
      const { items } = buildEspelhoFromAiData(inv, plWithEan, bl, { eanIndex: emptyIndex });
      const pi = items.find((i) => i.codigo === 'PI7752Y')!;
      expect(pi.ean).toBe('7891276565590');
      expect(pi.eanSource).toBe('document');
    });

    it('enriches missing EAN from the Base EAN KB (eanSource: kb), never guessing ambiguous ones', () => {
      const kbIndex = createEanIndex([
        { ean: '7909692093303', product: '10604232', grade: '34 A 39', color: '100' },
        { ean: '7909692093310', product: '10604232', grade: '40 A 44', color: '100' },
        { ean: '96385074', product: 'AC2285Y', grade: null, color: null },
      ]);
      const invKb = {
        ...inv,
        items: [
          { itemCode: 'AC2285Y', quantity: 50, unitPrice: 3.0, totalPrice: 150 }, // single EAN in KB
          { itemCode: '10604232', quantity: 10, unitPrice: 1.0, totalPrice: 10 }, // ambiguous in KB
          { itemCode: '10604232', size: '40 A 44', quantity: 5, unitPrice: 1.0, totalPrice: 5 },
        ],
      };
      const { items } = buildEspelhoFromAiData(invKb, { items: [] }, bl, { eanIndex: kbIndex });

      expect(items[0].ean).toBe('96385074');
      expect(items[0].eanSource).toBe('kb');

      expect(items[1].ean).toBe(null); // two KB candidates, no size → no guess
      expect(items[1].eanSource).toBe(null);

      expect(items[2].ean).toBe('7909692093310'); // disambiguated by size/grade
      expect(items[2].eanSource).toBe('kb');
    });

    it('prefers the document EAN over the KB when both exist', () => {
      const kbIndex = createEanIndex([
        { ean: '96385074', product: 'PI7752Y', grade: null, color: null },
      ]);
      const invDoc = {
        ...inv,
        items: [
          {
            itemCode: 'PI7752Y',
            ean: '7891276565590',
            quantity: 100,
            unitPrice: 5.5,
            totalPrice: 550,
          },
        ],
      };
      const { items } = buildEspelhoFromAiData(invDoc, pl, bl, { eanIndex: kbIndex });
      expect(items[0].ean).toBe('7891276565590');
      expect(items[0].eanSource).toBe('document');
    });
  });
});
