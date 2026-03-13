import { z } from 'zod';

export const emailAnalysisResponseSchema = z.object({
  processCode: z.string().nullable(),
  documentTypes: z.array(z.string()).default([]),
  invoiceNumbers: z.array(z.string()).default([]),
  urgencyLevel: z.enum(['normal', 'urgent', 'critical']).default('normal'),
  emailCategory: z
    .enum(['new_shipment', 'document_delivery', 'correction', 'follow_up', 'payment', 'general'])
    .default('general'),
  keyDates: z
    .array(
      z.object({
        type: z.string(),
        date: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
  supplierName: z.string().nullable().default(null),
});

export type EmailAnalysisResponse = z.infer<typeof emailAnalysisResponseSchema>;
