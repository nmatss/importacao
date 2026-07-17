import { z } from 'zod';

export const uploadDocumentSchema = z.object({
  processId: z.coerce.number(),
  documentType: z.enum([
    'invoice',
    'proforma_invoice',
    'packing_list',
    'ohbl',
    'draft_bl',
    'draft_duimp',
    'duimp',
    'espelho',
    'li',
    'certificate',
    'other',
  ]),
});

export const reprocessDocumentSchema = z.object({
  documentId: z.coerce.number(),
});

export const reclassifyDocumentSchema = z.object({
  documentType: uploadDocumentSchema.shape.documentType,
});

export const acceptComparisonSchema = z.object({
  scope: z.enum(['aggregate', 'item']),
  rowKey: z.string().trim().min(1).max(160),
  fieldLabel: z.string().trim().min(1).max(160).optional(),
  itemCode: z.string().trim().max(80).optional().nullable(),
  previousStatus: z.enum(['divergent', 'warning', 'match', 'empty', 'single_source']).optional(),
  resolution_note: z.string().trim().min(3).max(1000),
});

export const editComparisonFieldSchema = z.object({
  rowKey: z.string().trim().min(1).max(160),
  fieldLabel: z.string().trim().min(1).max(160),
  sourceColumn: z.enum(['invoice', 'packingList', 'bl', 'espelho', 'system']),
  value: z.string().trim().max(5000).nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type ReclassifyDocumentInput = z.infer<typeof reclassifyDocumentSchema>;
export type AcceptComparisonInput = z.infer<typeof acceptComparisonSchema>;
export type EditComparisonFieldInput = z.infer<typeof editComparisonFieldSchema>;
