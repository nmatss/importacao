import { z } from 'zod';

const confidenceField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
  });

const proformaItemSchema = z.object({
  itemCode: confidenceField(z.string()),
  description: confidenceField(z.string()),
  color: confidenceField(z.string()).optional(),
  size: confidenceField(z.string()).optional(),
  quantity: confidenceField(z.number()),
  unitPrice: confidenceField(z.number()),
  totalPrice: confidenceField(z.number()),
  ncmCode: confidenceField(z.string()).optional(),
  unitType: confidenceField(z.string()).optional(),
  isFreeOfCharge: confidenceField(z.boolean()).optional(),
});

const paymentTermsValue = z.object({
  depositPercent: z.number().nullable().optional(),
  balancePercent: z.number().nullable().optional(),
  paymentDays: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const proformaResponseSchema = z.object({
  piNumber: confidenceField(z.string()),
  invoiceNumber: confidenceField(z.string()).optional(),
  invoiceDate: confidenceField(z.string()).optional(),
  validUntil: confidenceField(z.string()).optional(),
  exporterName: confidenceField(z.string()),
  exporterAddress: confidenceField(z.string()).optional(),
  exporterTaxId: confidenceField(z.string()).optional(),
  importerName: confidenceField(z.string()),
  importerAddress: confidenceField(z.string()).optional(),
  importerCnpj: confidenceField(z.string()).optional(),
  incoterm: confidenceField(z.string()).optional(),
  currency: confidenceField(z.string()),
  portOfLoading: confidenceField(z.string()).optional(),
  portOfDischarge: confidenceField(z.string()).optional(),
  items: z.array(proformaItemSchema),
  paymentTerms: confidenceField(paymentTermsValue).optional(),
  totalFobValue: confidenceField(z.number()),
  totalBoxes: confidenceField(z.number()).optional(),
  totalNetWeight: confidenceField(z.number()).optional(),
  totalGrossWeight: confidenceField(z.number()).optional(),
  totalCbm: confidenceField(z.number()).optional(),
});

export type ProformaResponse = z.infer<typeof proformaResponseSchema>;
