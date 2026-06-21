import { describe, expect, it } from 'vitest';
import { tryParseProformaText, fillProformaNullsFromText } from '../proforma-text-parser.js';

const proformaText = `PROFORMA INVOICE
PI No: PI7765Y        Date: 15/03/2024
Exporter: KIOM INDUSTRY CO., LTD - NINGBO, CHINA
Importer: UNI.CO COMERCIO S/A  CNPJ: 00.399.603/0006-12
Incoterm: FOB        Currency: USD
Port of Loading: NINGBO        Port of Discharge: SANTOS, BRAZIL
Item   Code      Description                Qty     Unit Price   Amount     NCM
1      PI7752Y   MOTHERS BLANKET PU         120     8.50         1020.00    6115.95.00
2      FOC001    FREE OF CHARGE SAMPLE      1       266.40       0.00       9503.00.99
TOTAL FOB: USD 1020.00`;

describe('proforma text parser', () => {
  it('extracts PI number, currency, FOB total and NCM-anchored items', () => {
    const parsed = tryParseProformaText(proformaText);

    expect(parsed).not.toBeNull();
    expect(parsed?.piNumber.value).toBe('PI7765Y');
    expect(parsed?.invoiceDate.value).toBe('2024-03-15');
    expect(parsed?.exporterName.value).toBe('KIOM INDUSTRY CO., LTD');
    expect(parsed?.importerCnpj.value).toBe('00.399.603/0006-12');
    expect(parsed?.currency.value).toBe('USD');
    expect(parsed?.incoterm.value).toBe('FOB');
    expect(parsed?.portOfLoading.value).toBe('NINGBO');
    expect(parsed?.portOfDischarge.value).toBe('SANTOS, BRAZIL');
    expect(parsed?.totalFobValue.value).toBe(1020);
    expect(parsed?.items).toHaveLength(2);
    expect(parsed?.items[0].itemCode.value).toBe('PI7752Y');
    expect(parsed?.items[0].quantity.value).toBe(120);
    expect(parsed?.items[0].ncmCode.value).toBe('6115.95.00');
    expect(parsed?.items[1].isFreeOfCharge.value).toBe(true);
  });

  it('returns {value,confidence} fields so projection works', () => {
    const parsed = tryParseProformaText(proformaText);
    expect(parsed?.piNumber).toEqual(expect.objectContaining({ value: 'PI7765Y' }));
    expect(typeof parsed?.piNumber.confidence).toBe('number');
    expect(parsed?.totalFobValue.confidence).toBeGreaterThan(0);
  });

  it('returns null for a definitive commercial invoice (no proforma signal)', () => {
    const parsed = tryParseProformaText(`COMMERCIAL INVOICE
Invoice No: IM0712602NB        Date: 2024-03-15
TOTAL FOB: USD 1020.00`);
    expect(parsed).toBeNull();
  });

  it('rejects domestic fiscal documents in BRL', () => {
    const parsed = tryParseProformaText(`PROFORMA INVOICE DANFE
NOTA FISCAL ELETRONICA NF-E
Valor Total R$ 1.234,56`);
    expect(parsed).toBeNull();
  });
});

describe('fillProformaNullsFromText', () => {
  // Proforma carrying PI + FOB but NO NCM line items: the deterministic
  // short-circuit does not fire, so the model path must still recover the
  // scalars instead of dropping them (Eduarda: proforma "não preencheu FOB").
  const piOnlyText = `PROFORMA INVOICE
PI No: PI9001Y        Date: 10/02/2026
Incoterm: FOB        Currency: USD
TOTAL FOB: USD 4500.00`;

  it('fills null PI number and FOB from the deterministic parse', () => {
    const modelData: Record<string, any> = {
      piNumber: { value: null, confidence: 0 },
      totalFobValue: { value: null, confidence: 0 },
      currency: { value: null, confidence: 0 },
      items: [],
    };
    const filled = fillProformaNullsFromText(modelData, piOnlyText);
    expect(filled.piNumber.value).toBe('PI9001Y');
    expect(filled.totalFobValue.value).toBe(4500);
    expect(filled.currency.value).toBe('USD');
  });

  it('does not overwrite values the model already extracted', () => {
    const modelData: Record<string, any> = {
      piNumber: { value: 'PI-MODEL', confidence: 0.9 },
      totalFobValue: { value: null, confidence: 0 },
      items: [],
    };
    const filled = fillProformaNullsFromText(modelData, piOnlyText);
    expect(filled.piNumber.value).toBe('PI-MODEL');
    expect(filled.totalFobValue.value).toBe(4500);
  });

  it('returns the data untouched when the text is not a proforma', () => {
    const modelData: Record<string, any> = { piNumber: { value: null, confidence: 0 } };
    const filled = fillProformaNullsFromText(modelData, 'COMMERCIAL INVOICE only');
    expect(filled.piNumber.value).toBeNull();
  });
});
