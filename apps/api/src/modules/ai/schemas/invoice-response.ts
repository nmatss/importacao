import { z } from 'zod';

const confidenceField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
  });

const invoiceItemSchema = z.object({
  itemCode: confidenceField(z.string()),
  // EAN/GTIN barcode (8/12/13/14 digits) — only when printed on the document.
  ean: confidenceField(z.string()).optional(),
  description: confidenceField(z.string()),
  color: confidenceField(z.string()).optional(),
  size: confidenceField(z.string()).optional(),
  quantity: confidenceField(z.number()),
  unitPrice: confidenceField(z.number()),
  totalPrice: confidenceField(z.number()),
  netWeight: confidenceField(z.number()).optional(),
  grossWeight: confidenceField(z.number()).optional(),
  ncmCode: confidenceField(z.string()).optional(),
  unitType: confidenceField(z.string()).optional(),
  manufacturer: confidenceField(z.string()).optional(),
  // Item gratuito (FOC/sample/brinde) — não entra na soma do totalFobValue.
  isFreeOfCharge: confidenceField(z.boolean()).optional(),
});

const paymentTermsValue = z.object({
  depositPercent: z.number().nullable().optional(),
  balancePercent: z.number().nullable().optional(),
  paymentDays: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const invoiceResponseSchema = z.object({
  invoiceNumber: confidenceField(z.string()),
  invoiceDate: confidenceField(z.string()),
  shipmentDate: confidenceField(z.string()).optional(),
  etd: confidenceField(z.string()).optional(),
  shippedOnBoardDate: confidenceField(z.string()).optional(),
  exporterName: confidenceField(z.string()),
  exporterAddress: confidenceField(z.string()),
  exporterTaxId: confidenceField(z.string()).optional(),
  importerName: confidenceField(z.string()),
  importerAddress: confidenceField(z.string()),
  importerCnpj: confidenceField(z.string()).optional(),
  incoterm: confidenceField(z.string()),
  currency: confidenceField(z.string()),
  portOfLoading: confidenceField(z.string()),
  portOfDischarge: confidenceField(z.string()),
  items: z.array(invoiceItemSchema),
  manufacturerName: confidenceField(z.string()).optional(),
  manufacturerAddress: confidenceField(z.string()).optional(),
  paymentTerms: confidenceField(paymentTermsValue).optional(),
  totalFobValue: confidenceField(z.number()),
  totalBoxes: confidenceField(z.number()).optional(),
  totalNetWeight: confidenceField(z.number()).optional(),
  totalGrossWeight: confidenceField(z.number()).optional(),
  totalCbm: confidenceField(z.number()).optional(),
});

export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;
