/**
 * Deterministic AI extractions for the import-flow happy-path e2e test.
 *
 * These mirror the shape a real extraction produces and is stored in
 * documents.ai_parsed_data: scalar fields are { value, confidence } wrappers
 * (flattenAiData unwraps them at compare/validation time) and `items` is a
 * plain array. The Invoice and Packing List share two SKUs (PI7752Y, AC2285Y)
 * with identical quantities so cross-document matching yields a clean 'match';
 * the BL carries the same exporter/importer so the aggregate party rows agree.
 *
 * Item codes follow the Uni.co canonical pattern (2-4 letters + 3-7 digits +
 * optional suffix) so itemCodesMatch() pairs them deterministically.
 */

const EXPORTER_NAME = 'KIOM TEXTILE CO., LTD.';
const IMPORTER_NAME = 'PUKET CONFECCOES LTDA';

function field<T>(value: T, confidence = 0.95): { value: T; confidence: number } {
  return { value, confidence };
}

export const INVOICE_EXTRACTION = {
  invoiceNumber: field('KIOM-INV-2026-001'),
  invoiceDate: field('2026-05-10'),
  exporterName: field(EXPORTER_NAME),
  importerName: field(IMPORTER_NAME),
  currency: field('USD'),
  totalAmount: field(2000),
  items: [
    {
      itemCode: 'PI7752Y',
      description: 'Pijama Infantil Estampado',
      ncmCode: '6108.31.00',
      quantity: 100,
      unitPrice: 12.5,
      totalPrice: 1250,
      boxQuantity: 10,
      netWeight: 80,
      grossWeight: 90,
    },
    {
      itemCode: 'AC2285Y',
      description: 'Acessorio Meia Kit',
      ncmCode: '6115.96.00',
      quantity: 50,
      unitPrice: 15,
      totalPrice: 750,
      boxQuantity: 5,
      netWeight: 20,
      grossWeight: 25,
    },
  ],
};

export const PACKING_LIST_EXTRACTION = {
  exporterName: field(EXPORTER_NAME),
  importerName: field(IMPORTER_NAME),
  totalBoxes: field(15),
  totalNetWeight: field(100),
  totalGrossWeight: field(115),
  items: [
    {
      itemCode: 'PI7752Y',
      description: 'Pijama Infantil Estampado',
      quantity: 100,
      boxQuantity: 10,
      netWeight: 80,
      grossWeight: 90,
    },
    {
      itemCode: 'AC2285Y',
      description: 'Acessorio Meia Kit',
      quantity: 50,
      boxQuantity: 5,
      netWeight: 20,
      grossWeight: 25,
    },
  ],
};

export const BL_EXTRACTION = {
  blNumber: field('KIOMBL2026001'),
  shipper: field(EXPORTER_NAME),
  consignee: field(IMPORTER_NAME),
  portOfLoading: field('NINGBO'),
  portOfDischarge: field('SANTOS'),
  vesselName: field('EVER GIVEN'),
};
