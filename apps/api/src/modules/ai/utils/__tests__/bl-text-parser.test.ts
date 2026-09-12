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
Container No: TCLU1234568
Seal No: KIO98765
Total Packages: 120
Total Gross Weight: 2,345.60 KGS
Total CBM: 18.45
Freight USD 1234.50
Free Time: 14 days
Cargo Description: GARMENTS AND HOME DECORATION PRODUCTS
NCM 6115.95.00`;

/**
 * GABARITO EM BRANCO — reproduz a ESTRUTURA do OCR dos BLs 155/156/165/166
 * (reuniao 11/09/2026): PDF cuja camada de texto o servidor nao le, entao o OCR
 * devolve so os rotulos impressos do formulario, com os erros tipicos de
 * reconhecimento ("Skipper" por "Shipper", "Conlainer", "Sesl No."). Nenhum
 * dado de cliente: e formulario vazio. Antes da blindagem, este texto produzia
 * blNumber "Skipper", containerNumber "ainers" (pedaco de "Containers"),
 * vesselName "Place of receipt" e descricao "No, o" — tudo com confianca 0.82,
 * o que AINDA INFLAVA a nota do documento.
 */
const blankFormOcrText = `— Nordica LOGISTIC

BILL OF LADING

B/L No

Skipper

Shipper. One origi

Carsignee Nalify prearly

Local Vessel Place of receipt

QOcecn Vessel Port of coding

Port of d'scharge Place of delivery

PARTICULARS FURNISHED BY SHIPPER

Kind of Packoges. descriston of goous

Marks and Number No, o
Conlainer No. Sesl No. Containers
cr pkgs

Gross weight Mensurement

Freitaht end Charges Ravenue loms * Rato Per Prepaid i Colec*

Shiprer-Reference S/C Preccid at

AS CARRIER

N 0041682`;

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
    expect(parsed?.containerNumber.value).toBe('TCLU1234568');
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

  it('never turns blank-form OCR labels into BL data (regressão "ainers")', () => {
    const modelData = {
      blNumber: { value: null, confidence: 0 },
      customerReference: { value: null, confidence: 0 },
      shipper: { value: null, confidence: 0 },
      consignee: { value: null, confidence: 0 },
      vesselName: { value: null, confidence: 0 },
      containerNumber: { value: null, confidence: 0 },
      cargoDescription: { value: null, confidence: 0 },
    };

    const filled = fillBLNullsFromText(modelData, blankFormOcrText);

    expect(filled.containerNumber.value).toBeNull();
    expect(filled.blNumber.value).toBeNull();
    expect(filled.customerReference.value).toBeNull();
    expect(filled.vesselName.value).toBeNull();
    expect(filled.cargoDescription.value).toBeNull();
    // Nenhum campo pode ter sido preenchido a partir de rótulo de formulário.
    for (const field of Object.values(filled)) {
      expect((field as { value: unknown }).value).toBeNull();
    }
  });

  it('rejects a container number that fails the ISO 6346 check digit', () => {
    const badContainer = blText.replace('TCLU1234568', 'TCLU1234567');
    expect(tryParseBLText(badContainer)?.containerNumber.value).toBeNull();
  });

  it('keeps every valid container of a multi-container BL and drops the invalid ones', () => {
    const twoContainers = blText.replace(
      'Container No: TCLU1234568',
      'Container No: MNBU3949421, MNBU0184030, ZZZZ0000000',
    );
    expect(tryParseBLText(twoContainers)?.containerNumber.value).toBe('MNBU3949421,MNBU0184030');
  });

  it('marks text-recovered values as fallback confidence (never as a first-class read)', () => {
    const parsed = tryParseBLText(blText);
    expect(parsed?.blNumber.confidence).toBeLessThanOrEqual(0.5);
    expect(parsed?.shipper.confidence).toBeLessThanOrEqual(0.5);
  });

  it('does not fill anything when the source text is support-only (OCR + PDF anexado)', () => {
    const modelData = {
      vesselName: { value: null, confidence: 0 },
      portOfLoading: { value: null, confidence: 0 },
    };

    const filled = fillBLNullsFromText(modelData, blText, { sourceTextReliable: false });

    expect(filled.vesselName.value).toBeNull();
    expect(filled.portOfLoading.value).toBeNull();
  });
});
