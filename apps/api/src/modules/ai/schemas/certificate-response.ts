import { z } from 'zod';

const confidenceField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
  });

const certificateItemSchema = z.object({
  description: confidenceField(z.string()),
  itemCode: confidenceField(z.string()).optional(),
  ncmCode: confidenceField(z.string()).optional(),
  quantity: confidenceField(z.number()).optional(),
});

export const certificateResponseSchema = z.object({
  certificateType: confidenceField(z.string()),
  certificateNumber: confidenceField(z.string()),
  issuingAuthority: confidenceField(z.string()),
  issueDate: confidenceField(z.string()),
  expirationDate: confidenceField(z.string()),
  exporterName: confidenceField(z.string()),
  importerName: confidenceField(z.string()),
  countryOfOrigin: confidenceField(z.string()),
  invoiceReference: confidenceField(z.string()),
  items: z.array(certificateItemSchema).optional(),
  observations: confidenceField(z.string()).optional(),
});

export type CertificateResponse = z.infer<typeof certificateResponseSchema>;
