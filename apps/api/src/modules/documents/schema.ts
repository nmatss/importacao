import { z } from 'zod';

export const uploadDocumentSchema = z.object({
  processId: z.coerce.number(),
  documentType: z.enum([
    'invoice',
    'proforma_invoice',
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

export const acceptComparisonSchema = z.object({
  scope: z.enum(['aggregate', 'item']),
  rowKey: z.string().trim().min(1).max(160),
  fieldLabel: z.string().trim().min(1).max(160).optional(),
  itemCode: z.string().trim().max(80).optional().nullable(),
  previousStatus: z.enum(['divergent', 'warning', 'match', 'empty']).optional(),
  resolution_note: z.string().trim().min(3).max(1000),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type AcceptComparisonInput = z.infer<typeof acceptComparisonSchema>;
