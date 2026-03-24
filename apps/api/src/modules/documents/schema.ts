import { z } from 'zod';

export const uploadDocumentSchema = z.object({
  processId: z.coerce.number(),
  documentType: z.enum([
    'invoice',
    'packing_list',
    'ohbl',
    'draft_bl',
    'espelho',
    'li',
    'certificate',
    'other',
  ]),
});

export const reprocessDocumentSchema = z.object({
  documentId: z.coerce.number(),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
