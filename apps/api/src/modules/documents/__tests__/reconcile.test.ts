import { describe, expect, it } from 'vitest';
import {
  reconcileItemizedDoc,
  selectTrustedEspelho,
  type EspelhoSource,
} from '../reconcile-core.js';
import { computeConfidenceScore } from '../../ai/utils/confidence.js';

// { value, confidence } wrapper helper, mirroring the extraction shape.
const cf = (value: unknown, confidence: number) => ({ value, confidence });

/**
 * Faithful slim fixture from process 264 (KIOM IM0712602NB):
 *  - 2 charged items + 1 Free-Of-Charge item (AC 2285Y), so the FOB excludes
 *    the FOC line — exactly the real "Σ items ≠ FOB but Σ non-FOC == FOB" case;
 *  - invoice item nulls (ncm/ean/manufacturer) present in the espelho;
 *  - invoice scalar nulls (importer*, weights, boxes, cbm) present in summary.
 */
function buildInvoice() {
  return {
    invoiceNumber: cf('IM0712602NB', 0.9),
    invoiceDate: cf('2026-02-22', 0.82),
    exporterName: cf('KIOM GLOBAL LIMITED', 0.86),
    importerName: cf(null, 0),
    importerCnpj: cf(null, 0),
    importerAddress: cf(null, 0),
    currency: cf('USD', 0.86),
    incoterm: cf('FOB', 0.82),
    portOfLoading: cf('NINGBO', 0.78),
    portOfDischarge: cf('ITAPOA', 0.78),
    totalFobValue: cf(12812, 0.86),
    totalBoxes: cf(null, 0),
    totalNetWeight: cf(null, 0),
    totalGrossWeight: cf(null, 0),
    totalCbm: cf(null, 0),
    items: [
      {
        itemCode: cf('PI7765Y', 0.8),
        ean: cf(null, 0),
        ncmCode: cf(null, 0),
        description: cf('VISTO BAG', 0.7),
        quantity: cf(800, 0.78),
        unitPrice: cf(6.39, 0.78),
        totalPrice: cf(5112, 0.76),
        unitType: cf('PC', 0.78),
        manufacturer: cf(null, 0),
        isFreeOfCharge: cf(false, 0.82),
      },
      {
        itemCode: cf('PI7752Y', 0.8),
        ean: cf(null, 0),
        ncmCode: cf(null, 0),
        description: cf('BLOUSE', 0.7),
        quantity: cf(1000, 0.78),
        unitPrice: cf(7.7, 0.78),
        totalPrice: cf(7700, 0.76),
        unitType: cf('PC', 0.78),
        manufacturer: cf(null, 0),
        isFreeOfCharge: cf(false, 0.82),
      },
      {
        itemCode: cf('AC 2285Y', 0.8), // note the space — normalizes to AC2285Y
        ean: cf(null, 0),
        ncmCode: cf(null, 0),
        description: cf('GIFT', 0.7),
        quantity: cf(120, 0.78),
        unitPrice: cf(2.22, 0.78),
        totalPrice: cf(266.4, 0.76),
        unitType: cf('PC', 0.78),
        manufacturer: cf(null, 0),
        isFreeOfCharge: cf(true, 0.82),
      },
    ],
  };
}

const espelho: EspelhoSource = {
  summary: {
    totalAmountUsd: 12812,
    totalBoxes: 314,
    totalNetWeight: 2801.56,
    totalGrossWeight: 3171.9,
    totalCbm: 21.557,
    importerName: 'UNI.CO COMERCIO S/A',
    importerCnpj: '00.399.603/0006-12',
    importerAddress: 'RUA GERCINO MACHADO, 207',
  },
  items: [
    {
      codigo: 'PI7765Y',
      qty: 800,
      unitPrice: 6.39,
      amountUsd: 5112,
      ncm: '63014000',
      ean13: '7898458249217',
      codFabricante: '10003',
      cor: null,
      tamanho: null,
      pesoLiquidoTotal: 100,
      pesoBrutoTotal: 120,
      fornecedor: 'KIOM GLOBAL LIMITED',
    },
    {
      codigo: 'PI7752Y',
      qty: 1000,
      unitPrice: 7.7,
      amountUsd: 7700,
      ncm: '61089200',
      ean13: '7898458249309',
      codFabricante: '10003',
      fornecedor: 'KIOM GLOBAL LIMITED',
    },
    {
      codigo: 'AC2285Y',
      qty: 120,
      unitPrice: 2.22,
      amountUsd: 266.4,
      ncm: '83024900',
      ean13: '7898458251579',
      codFabricante: '10046',
      fornecedor: 'KIOM GLOBAL LIMITED',
    },
  ],
};

const cval = (f: any) => (f && typeof f === 'object' && 'value' in f ? f.value : f);

describe('reconcileItemizedDoc — invoice against trusted espelho', () => {
  it('raises the overall confidence well above the deterministic floor', () => {
    const data = buildInvoice();
    const before = computeConfidenceScore(data).score;
    const report = reconcileItemizedDoc(data, 'invoice', espelho);
    const after = computeConfidenceScore(data).score;

    expect(report.changed).toBe(true);
    expect(before).toBeLessThan(0.8);
    expect(after).toBeGreaterThan(0.9);
    expect(after).toBeGreaterThan(before);
  });

  it('cross-confirms code/quantity/unitPrice/totalPrice to 0.99', () => {
    const data = buildInvoice();
    reconcileItemizedDoc(data, 'invoice', espelho);
    for (const it of data.items) {
      expect((it.itemCode as any).confidence).toBe(0.99);
      expect((it.quantity as any).confidence).toBe(0.99);
      expect((it.unitPrice as any).confidence).toBe(0.99);
      expect((it.totalPrice as any).confidence).toBe(0.99);
    }
  });

  it('fills item nulls (ncm, ean, manufacturer) from the espelho with provenance', () => {
    const data = buildInvoice();
    reconcileItemizedDoc(data, 'invoice', espelho);
    const first = data.items[0];
    expect(cval(first.ncmCode)).toBe('6301.40.00'); // normalized
    expect(cval(first.ean)).toBe('7898458249217');
    expect(cval(first.manufacturer)).toBe('10003');
    expect((first.ean as any).source).toBe('espelho');
    expect((first.ncmCode as any).confidence).toBe(0.95);
  });

  it('fills invoice scalar nulls (importer, weights, boxes, cbm) from the summary', () => {
    const data = buildInvoice();
    reconcileItemizedDoc(data, 'invoice', espelho);
    expect(cval(data.importerName)).toBe('UNI.CO COMERCIO S/A');
    expect(cval(data.importerCnpj)).toBe('00.399.603/0006-12');
    expect(cval(data.totalBoxes)).toBe(314);
    expect(cval(data.totalNetWeight)).toBe(2801.56);
    expect(cval(data.totalCbm)).toBe(21.557);
  });

  it('cross-confirms totalFobValue against the summary total', () => {
    const data = buildInvoice();
    reconcileItemizedDoc(data, 'invoice', espelho);
    expect((data.totalFobValue as any).confidence).toBe(0.99);
  });

  it('confirms the Free-Of-Charge partition arithmetically', () => {
    const data = buildInvoice();
    reconcileItemizedDoc(data, 'invoice', espelho);
    for (const it of data.items) {
      expect((it.isFreeOfCharge as any).confidence).toBe(0.95);
    }
  });
});

describe('reconcileItemizedDoc — conservative guarantees', () => {
  it('never overwrites a non-null value and logs a conflict on disagreement', () => {
    const data = buildInvoice();
    (data.items[0].quantity as any) = cf(999, 0.78); // wrong qty vs espelho 800
    const report = reconcileItemizedDoc(data, 'invoice', espelho);
    expect(cval(data.items[0].quantity)).toBe(999); // untouched
    expect(report.conflicts.some((c) => c.path === 'items[0].quantity')).toBe(true);
  });

  it('applies arithmetic boosts even with no espelho source', () => {
    const data = buildInvoice();
    const report = reconcileItemizedDoc(data, 'invoice', null);
    expect(report.changed).toBe(true);
    // qty×unit==total holds for every item → arithmetic boost 0.97
    expect((data.items[0].quantity as any).confidence).toBe(0.97);
    // but nothing is filled without a source
    expect(cval(data.items[0].ncmCode)).toBeNull();
  });

  it('is idempotent — a second pass changes nothing', () => {
    const data = buildInvoice();
    reconcileItemizedDoc(data, 'invoice', espelho);
    const second = reconcileItemizedDoc(data, 'invoice', espelho);
    expect(second.changed).toBe(false);
    expect(second.boosted).toHaveLength(0);
    expect(second.filled).toHaveLength(0);
  });
});

describe('selectTrustedEspelho', () => {
  const base = {
    id: 1,
    type: 'espelho',
    isProcessed: true,
    confidenceScore: '0.99',
  };

  it('accepts an operator-uploaded espelho (0.99, no generatedBy)', () => {
    const docs = [
      { ...base, aiParsedData: { summary: { totalAmountUsd: 100 }, items: [{ codigo: 'X' }] } },
    ];
    expect(selectTrustedEspelho(docs as any)).not.toBeNull();
  });

  it('rejects an auto-generated espelho (would be circular)', () => {
    const docs = [
      {
        ...base,
        aiParsedData: {
          summary: { generatedBy: 'auto_deterministic' },
          items: [{ codigo: 'X' }],
        },
      },
    ];
    expect(selectTrustedEspelho(docs as any)).toBeNull();
  });

  it('rejects a low-confidence (AI-fallback) espelho', () => {
    const docs = [
      { ...base, confidenceScore: '0.70', aiParsedData: { summary: {}, items: [{ codigo: 'X' }] } },
    ];
    expect(selectTrustedEspelho(docs as any)).toBeNull();
  });
});
