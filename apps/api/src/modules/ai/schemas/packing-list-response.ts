import { z } from 'zod';

const confidenceField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
  });

const packingListItemSchema = z.object({
  itemCode: confidenceField(z.string()),
  // EAN/GTIN barcode (8/12/13/14 digits) — only when printed on the document.
  ean: confidenceField(z.string()).optional(),
  description: confidenceField(z.string()),
  color: confidenceField(z.string()).optional(),
  size: confidenceField(z.string()).optional(),
  quantity: confidenceField(z.number()),
  boxQuantity: confidenceField(z.number()),
  netWeight: confidenceField(z.number()),
  grossWeight: confidenceField(z.number()),
});

export const packingListResponseSchema = z.object({
  packingListNumber: confidenceField(z.string()),
  invoiceNumber: confidenceField(z.string()).optional(),
  date: confidenceField(z.string()),
  exporterName: confidenceField(z.string()),
  exporterAddress: confidenceField(z.string()).optional(),
  exporterTaxId: confidenceField(z.string()).optional(),
  importerName: confidenceField(z.string()),
  importerAddress: confidenceField(z.string()).optional(),
  importerCnpj: confidenceField(z.string()).optional(),
  portOfLoading: confidenceField(z.string()).optional(),
  portOfDischarge: confidenceField(z.string()).optional(),
  items: z.array(packingListItemSchema),
  totalBoxes: confidenceField(z.number()),
  totalNetWeight: confidenceField(z.number()),
  totalGrossWeight: confidenceField(z.number()),
  totalCbm: confidenceField(z.number()),
});

export type PackingListResponse = z.infer<typeof packingListResponseSchema>;
