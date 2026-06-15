import { describe, expect, it } from 'vitest';
import { repairInvoiceExtractionFromText, tryParseInvoiceText } from '../invoice-text-parser.js';

const invoiceText = `COMMERCIAL INVOICE
Invoice No: IM0712602NB        Date: 2026-05-12
Exporter: KIOM GLOBAL LIMITED - NINGBO, CHINA
Importer: UNI.CO COMERCIO S/A - SAO PAULO, BRASIL  CNPJ: 00.399.603/0006-12
Incoterm: FOB        Currency: USD
Port of Loading: NINGBO        Port of Discharge: ITAPOA, BRAZIL
Item   Code      Description                    Qty     Unit Price   Amount     NCM        EAN
1      PI7752Y   PRODUTO SANITIZADO             120     8.50         1020.00    6115.95.00 7909692093303
2      FOC001    FREE OF CHARGE DISCOUNT        1       266.40       0.00       9503.00.99
TOTAL FOB: USD 1020.00`;

describe('invoice text parser', () => {
  it('extracts a structured sanitized invoice without calling the LLM', () => {
    const parsed = tryParseInvoiceText(invoiceText);

    expect(parsed?.invoiceNumber.value).toBe('IM0712602NB');
    expect(parsed?.invoiceDate.value).toBe('2026-05-12');
    expect(parsed?.exporterName.value).toBe('KIOM GLOBAL LIMITED');
    expect(parsed?.importerCnpj.value).toBe('00.399.603/0006-12');
    expect(parsed?.currency.value).toBe('USD');
    expect(parsed?.portOfLoading.value).toBe('NINGBO');
    expect(parsed?.portOfDischarge.value).toBe('ITAPOA, BRAZIL');
    expect(parsed?.totalFobValue.value).toBe(1020);
    expect(parsed?.items).toHaveLength(2);
    expect(parsed?.items[0].itemCode.value).toBe('PI7752Y');
    expect(parsed?.items[0].quantity.value).toBe(120);
    expect(parsed?.items[0].ncmCode.value).toBe('6115.95.00');
    expect(parsed?.items[0].ean.value).toBe('7909692093303');
    expect(parsed?.items[1].isFreeOfCharge.value).toBe(true);
  });

  it('repairs exporterName when a carrier/vessel name was selected', () => {
    const repaired = repairInvoiceExtractionFromText(
      { exporterName: { value: 'COSCO SHIPPING ARGENTINA', confidence: 0.7 } },
      invoiceText,
    );

    expect(repaired.exporterName.value).toBe('KIOM GLOBAL LIMITED');
  });
});
