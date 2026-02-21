import { z } from 'zod';

export const uploadDocumentSchema = z.object({
  processId: z.coerce.number(),
  type: z.enum(['invoice', 'packing_list', 'ohbl', 'espelho', 'li', 'other']),
});

export const reprocessDocumentSchema = z.object({
  documentId: z.coerce.number(),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
