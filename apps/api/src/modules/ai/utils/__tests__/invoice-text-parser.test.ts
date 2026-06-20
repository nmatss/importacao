import { describe, expect, it } from 'vitest';
import {
  fillInvoiceNullsFromText,
  repairInvoiceExtractionFromText,
  tryParseInvoiceText,
} from '../invoice-text-parser.js';

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

  it('extracts KIOM compact PDF text with FOC discount without calling the LLM', () => {
    const compactKiomText = `PAGE 1
COMMERCIAL INVOICE
EXPORTERIMPORTERNOTIFY PARTYTERMS
TOTAL  FOBUSD24.312,52
KIOM GLOBAL LIMITEDUNI.CO COMERCIO S/AUNI.CO COMERCIO S/ACI NUMBERIM0712602NBPAYMENT TERMSSTA TUSDAYSDATE
BRN: 75433983CNPJ: 00.399.603/0006-12CNPJ: 00.399.603/0006-12CI DATE22-Feb-26FREIGHT0,00%USD0,00-
ROOM E, 10/F, NEW HENNESSY TOWERRUA GERCINO MACHADO, 207RUA GERCINO MACHADO, 207PO CUSTOMER REF-DEPOSIT15,81%USD3.843,60PAID
263 HENNESSY ROAD, WANCHAI, HONG KONGBIGUAÇU, SC, BRAZIL, ZIP 88164-290BIGUAÇU, SC, BRAZIL, ZIP 88164-290INCOTERMFOBBALANCE 10,00%USD0,00-7
PHONE: +86 755 8659 5020PHONE: +55 ( 48)  2107 5959PHONE: +55 ( 48)  2107 5959PORT OF LOADINGNINGBOBALANCE 163,69%USD15.483,92PEND ING1405-Mar-26
EMAIL: contact@kiomglobal.comEMAIL: controladoria@grupounico.comEMAIL: controladoria@grupounico.comPORT OF DESTINATIONITAPOABALANCE 220,50%USD4.985,00PEND ING6020-Apr-26
ETD22-Feb-260,00-
001IM1962601BSH2026 - FAT03PI7765YIMG-MOTHERS BLANKET-PU-IMGPOLYB AG--FINE TEXTILE800,00                                     PC  6,39                                               30%1.533,60                70%3.578,40            14
002IM1962601BSH2026 - FAT03PI7752YIMG-MOTHERS ROBE-PU-IMGPOLYB AG--FINE TEXTILE1.000,00                                PC  7,70                                               30%2.310,00                70%5.390,00            14
003IM2032601AXI2026 - FAT02PI7761YVISTO- M OTHER S THER M AL B AG- VI-IMGPOLYB AG--UN ITED500,00                                     PC4,33                                               0%-                             100%2.165,00            60
004IM2032601AXI2026 - FAT02PI5598YVISTO- B AG B OX C R EAM  GOLD  D ETAILS- VI-IMGPOLYB AG--UN ITED500,00                                     PC5,64                                               0%-                             100%2.820,00            60
005IM2072602ASZ2026 - FAT04PI7797YIMG-GLITTER PHOTO FRAME-HD-IMGWHITE BOX--A&C1.056,00                                PC2,56                                               0%-                             100%2.703,36            14
006IM2072602ASZ2026 - FAT04PI7795YIMG-POLAROID PHOTO FRAME KIT-HD-IMGWHITE BOX--A&C1.056,00                                SET3,61                                               0%-                             100%3.812,16            14
007IM2312602ANB2026 - FAT02AC 2285YIMG-AC HANDLE FOR PI6978Y-PUFREE OF CHARGE - -IMGPOLYB AG--WENZHOU ENRON120,00                                     PC2,22                                               30%79,92                       70%186,48                 7
TOTAL TO BE PAID5.032,00
FREE OF CHARGE (FOC)120,00-
TOTAL FOB4.912,00`;

    const parsed = tryParseInvoiceText(compactKiomText);

    expect(parsed?.invoiceNumber.value).toBe('IM0712602NB');
    expect(parsed?.invoiceDate.value).toBe('2026-02-22');
    expect(parsed?.exporterName.value).toBe('KIOM GLOBAL LIMITED');
    expect(parsed?.incoterm.value).toBe('FOB');
    expect(parsed?.currency.value).toBe('USD');
    expect(parsed?.portOfLoading.value).toBe('NINGBO');
    expect(parsed?.portOfDischarge.value).toBe('ITAPOA');
    expect(parsed?.totalFobValue.value).toBe(24312.52);
    expect(parsed?.items).toHaveLength(7);
    expect(parsed?.items[0].itemCode.value).toBe('PI7765Y');
    expect(parsed?.items[0].quantity.value).toBe(800);
    expect(parsed?.items[0].totalPrice.value).toBe(5112);
    expect(parsed?.items[6].itemCode.value).toBe('AC 2285Y');
    expect(parsed?.items[6].totalPrice.value).toBe(266.4);
    expect(parsed?.items[6].isFreeOfCharge.value).toBe(true);
  });

  it('fills invoiceDate, portOfLoading and exporterName left null by the model', () => {
    // Simulates a weak-model extraction: items present, header scalars null.
    const llmData = {
      invoiceNumber: { value: 'IM0712602NB', confidence: 0.9 },
      invoiceDate: { value: null, confidence: 0 },
      exporterName: { value: null, confidence: 0 },
      portOfLoading: { value: null, confidence: 0 },
      portOfDischarge: { value: null, confidence: 0 },
      currency: { value: null, confidence: 0 },
      importerCnpj: { value: null, confidence: 0 },
      items: [{ itemCode: { value: 'PI7752Y', confidence: 0.8 } }],
    };

    const filled = fillInvoiceNullsFromText(llmData, invoiceText);

    expect(filled.invoiceDate.value).toBe('2026-05-12');
    expect(filled.exporterName.value).toBe('KIOM GLOBAL LIMITED');
    expect(filled.portOfLoading.value).toBe('NINGBO');
    expect(filled.portOfDischarge.value).toBe('ITAPOA, BRAZIL');
    expect(filled.currency.value).toBe('USD');
    expect(filled.importerCnpj.value).toBe('00.399.603/0006-12');
    // Filled fields carry a modest confidence so the UI flags them for a glance.
    expect(filled.invoiceDate.confidence).toBeLessThan(0.82);
  });

  it('never overwrites values the model already extracted', () => {
    const llmData = {
      invoiceDate: { value: '2026-01-01', confidence: 0.95 },
      exporterName: { value: 'SOME OTHER EXPORTER LTD', confidence: 0.9 },
      portOfLoading: { value: 'SHANGHAI', confidence: 0.9 },
    };

    const filled = fillInvoiceNullsFromText(llmData, invoiceText);

    expect(filled.invoiceDate.value).toBe('2026-01-01');
    expect(filled.exporterName.value).toBe('SOME OTHER EXPORTER LTD');
    expect(filled.portOfLoading.value).toBe('SHANGHAI');
  });

  it('is a no-op when the text does not look like a commercial invoice', () => {
    const llmData = { invoiceDate: { value: null, confidence: 0 } };
    const filled = fillInvoiceNullsFromText(
      llmData,
      'random unrelated text without invoice markers',
    );
    expect(filled.invoiceDate.value).toBeNull();
  });

  it('extracts deposit/balance payment terms deterministically', () => {
    const text = `${invoiceText}
PAYMENT TERMS: 30% DEPOSIT, 70% BALANCE within 60 days`;
    const parsed = tryParseInvoiceText(text);
    expect(parsed?.paymentTerms.value.depositPercent).toBe(30);
    expect(parsed?.paymentTerms.value.balancePercent).toBe(70);
    expect(parsed?.paymentTerms.value.paymentDays).toBe(60);
  });

  it('infers the balance when only the deposit percent is present', () => {
    const text = `${invoiceText}
DEPOSIT 40%`;
    const parsed = tryParseInvoiceText(text);
    expect(parsed?.paymentTerms.value.depositPercent).toBe(40);
    expect(parsed?.paymentTerms.value.balancePercent).toBe(60);
  });

  it('discards implausible payment-term percentages (OCR noise that does not sum to ~100)', () => {
    const text = `${invoiceText}
DEPOSIT15,81% BALANCE 163,69%`;
    const parsed = tryParseInvoiceText(text);
    // 15.81 + 163.69 is nonsense -> both dropped, not trusted.
    expect(parsed?.paymentTerms.value.depositPercent).toBeNull();
    expect(parsed?.paymentTerms.value.balancePercent).toBeNull();
  });

  it('rejects an EAN with an invalid GS1 check digit (never used as a join key)', () => {
    const text = `COMMERCIAL INVOICE
Invoice No: IM-X        Date: 2026-05-12
TOTAL FOB: USD 100.00
1  PI0001Y  PRODUTO  10  10.00  100.00  6115.95.00  1234567890123`;
    const parsed = tryParseInvoiceText(text);
    // 1234567890123 has a bad check digit -> ean must be null.
    expect(parsed?.items[0]?.ean.value).toBeNull();
  });

  it('repairs exporterName when a carrier/vessel name was selected', () => {
    const repaired = repairInvoiceExtractionFromText(
      { exporterName: { value: 'COSCO SHIPPING ARGENTINA', confidence: 0.7 } },
      invoiceText,
    );

    expect(repaired.exporterName.value).toBe('KIOM GLOBAL LIMITED');
  });

  it('repairs exporterName when a generic shipping-line suffix was selected', () => {
    const repaired = repairInvoiceExtractionFromText(
      { exporterName: { value: 'GLOBAL SHIPPING LINE', confidence: 0.7 } },
      invoiceText,
    );

    expect(repaired.exporterName.value).toBe('KIOM GLOBAL LIMITED');
  });

  it('leaves a legitimate exporter untouched', () => {
    const original = { exporterName: { value: 'KIOM GLOBAL LIMITED', confidence: 0.9 } };
    const repaired = repairInvoiceExtractionFromText(original, invoiceText);

    expect(repaired.exporterName.value).toBe('KIOM GLOBAL LIMITED');
    expect(repaired.exporterName.confidence).toBe(0.9);
  });

  it('rejects domestic fiscal documents in BRL', () => {
    const parsed = tryParseInvoiceText(`DANFE
NOTA FISCAL ELETRONICA NF-E
Emitente: EMPRESA BRASILEIRA LTDA
CNPJ: 11.222.333/0001-81
Valor Total R$ 1.234,56`);

    expect(parsed).toBeNull();
  });
});
