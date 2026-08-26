import { describe, expect, it } from 'vitest';
import { fillBLNullsFromText, tryParseBLText } from '../bl-text-parser.js';

const blText = `OCEAN BILL OF LADING
B/L No: IM0712602NB
Customer Reference: IM0712602NB
Shipper: KIOM GLOBAL LIMITED
Consignee: UNI.CO COMERCIO S/A
Notify Party: UNI.CO COMERCIO S/A
Vessel: COSCO SHIPPING ARGENTINA
Voyage: 785E
Port of Loading: NINGBO
Port of Discharge: ITAPOA
ETD: 22-Feb-2026
ETA: 18-Apr-2026
Container No: TCLU1234567
Seal No: KIO98765
Total Packages: 120
Total Gross Weight: 2,345.60 KGS
Total CBM: 18.45
Freight USD 1234.50
Free Time: 14 days
Cargo Description: GARMENTS AND HOME DECORATION PRODUCTS
NCM 6115.95.00`;

describe('BL text parser', () => {
  it('extracts critical BL fields deterministically from text', () => {
    const parsed = tryParseBLText(blText);

    expect(parsed?.blNumber.value).toBe('IM0712602NB');
    expect(parsed?.customerReference.value).toBe('IM0712602NB');
    expect(parsed?.shipper.value).toBe('KIOM GLOBAL LIMITED');
    expect(parsed?.consignee.value).toBe('UNI.CO COMERCIO S/A');
    expect(parsed?.vesselName.value).toBe('COSCO SHIPPING ARGENTINA');
    expect(parsed?.voyageNumber.value).toBe('785E');
    expect(parsed?.portOfLoading.value).toBe('NINGBO');
    expect(parsed?.portOfDischarge.value).toBe('ITAPOA');
    expect(parsed?.containerNumber.value).toBe('TCLU1234567');
    expect(parsed?.sealNumber.value).toBe('KIO98765');
    expect(parsed?.totalBoxes.value).toBe(120);
    expect(parsed?.totalGrossWeight.value).toBe(2345.6);
    expect(parsed?.totalCbm.value).toBe(18.45);
    expect(parsed?.freeTime.value).toBe(14);
    expect(parsed?.ncmList.value).toEqual(['6115.95.00']);
  });

  it('fills only missing model fields and preserves fields already extracted by AI', () => {
    const modelData = {
      blNumber: { value: 'AI-BL-001', confidence: 0.95 },
      vesselName: { value: null, confidence: 0 },
      portOfLoading: { value: null, confidence: 0 },
      totalGrossWeight: { value: null, confidence: 0 },
    };

    const filled = fillBLNullsFromText(modelData, blText);

    expect(filled.blNumber.value).toBe('AI-BL-001');
    expect(filled.vesselName.value).toBe('COSCO SHIPPING ARGENTINA');
    expect(filled.portOfLoading.value).toBe('NINGBO');
    expect(filled.totalGrossWeight.value).toBe(2345.6);
  });

  it('treats PREPAID as a payment term and never backfills a freight amount', () => {
    const prepaidText = `OCEAN BILL OF LADING
B/L No: PK2112606NB
Freight PREPAID
Total Gross Weight: 6165668 KGS`;
    const parsed = tryParseBLText(prepaidText);
    const filled = fillBLNullsFromText(
      {
        freightValue: { value: 6165668, confidence: 0.8 },
        freightCurrency: { value: 'PREPAID', confidence: 0.95 },
      },
      prepaidText,
    );

    expect(parsed?.freightValue.value).toBeNull();
    expect(parsed?.freightCurrency.value).toBe('PREPAID');
    expect(filled.freightValue.value).toBeNull();
    expect(filled.freightCurrency.value).toBe('PREPAID');
  });
});
