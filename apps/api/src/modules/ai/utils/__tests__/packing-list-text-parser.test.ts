import { describe, expect, it } from 'vitest';
import { tryParsePackingListText } from '../packing-list-text-parser.js';

describe('tryParsePackingListText', () => {
  it('extracts a tabular packing list without calling the LLM', () => {
    const text = `PACKING LIST
Packing List No: PL-SAN-001      Date: 2026-05-12
Invoice No: INV-SAN-001
Exporter: SANITIZED EXPORTER LTD - NINGBO, CHINA
Importer: EMPRESA TESTE S/A CNPJ 11.222.333/0001-81
Port of Loading: NINGBO        Port of Discharge: ITAPOA, BRAZIL
Item Code Description Qty Cartons Net Weight Gross Weight EAN
1 TEST001 PRODUTO SANITIZADO 120 12 60.5 66.7 7909692093303
2 TEST002 PRODUTO EXTRA 80 8 40.0 45.0
Total Cartons: 20
Total Net Weight: 100.5
Total Gross Weight: 111.7
Total CBM: 2.34`;

    const parsed = tryParsePackingListText(text);

    expect(parsed?.packingListNumber.value).toBe('PL-SAN-001');
    expect(parsed?.invoiceNumber.value).toBe('INV-SAN-001');
    expect(parsed?.exporterName.value).toBe('SANITIZED EXPORTER LTD');
    expect(parsed?.importerCnpj.value).toBe('11.222.333/0001-81');
    expect(parsed?.portOfLoading.value).toBe('NINGBO');
    expect(parsed?.portOfDischarge.value).toBe('ITAPOA, BRAZIL');
    expect(parsed?.items).toHaveLength(2);
    expect(parsed?.items[0].itemCode.value).toBe('TEST001');
    expect(parsed?.items[0].quantity.value).toBe(120);
    expect(parsed?.items[0].boxQuantity.value).toBe(12);
    expect(parsed?.items[0].netWeight.value).toBe(60.5);
    expect(parsed?.items[0].grossWeight.value).toBe(66.7);
    expect(parsed?.totalBoxes.value).toBe(20);
    expect(parsed?.totalCbm.value).toBe(2.34);
  });

  it('rejects domestic fiscal documents', () => {
    const parsed = tryParsePackingListText('DANFE NOTA FISCAL ELETRONICA BRL R$ PACKING LIST');
    expect(parsed).toBeNull();
  });

  it('corrects net/gross weights printed in swapped order (net must be <= gross)', () => {
    // PI7752Y line prints G.W. before N.W. (200.0 then 180.5) -> the parser picks
    // them up swapped and must flip them, lowering confidence for review.
    const text = `PACKING LIST
Item Code Description Qty Cartons NW GW EAN
1 PI7752Y ROBE 1000 40 200.0 180.5 7909692093303
2 AC2285Y BAG 600 20 90.0 100.0 1234567890123`;

    const parsed = tryParsePackingListText(text);
    const robe = parsed?.items.find((i: any) => i.itemCode.value === 'PI7752Y');
    const bag = parsed?.items.find((i: any) => i.itemCode.value === 'AC2285Y');

    expect(robe.netWeight.value).toBe(180.5);
    expect(robe.grossWeight.value).toBe(200);
    expect(robe.netWeight.confidence).toBeLessThan(0.78);
    // Already-ordered weights are left untouched at full confidence.
    expect(bag.netWeight.value).toBe(90);
    expect(bag.grossWeight.value).toBe(100);
    expect(bag.netWeight.confidence).toBe(0.78);
  });

  it('accepts a valid GS1 EAN and rejects an invalid check digit', () => {
    const text = `PACKING LIST
Item Code Description Qty Cartons NW GW EAN
1 PI7752Y ROBE 1000 40 180.5 200.0 7909692093303
2 AC2285Y BAG 600 20 90.0 100.0 1234567890123`;

    const parsed = tryParsePackingListText(text);
    const robe = parsed?.items.find((i: any) => i.itemCode.value === 'PI7752Y');
    const bag = parsed?.items.find((i: any) => i.itemCode.value === 'AC2285Y');
    expect(robe.ean.value).toBe('7909692093303');
    expect(bag.ean.value).toBeNull(); // 1234567890123 has a bad check digit
  });
});
