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

// Editar a celula reescreve o valor comparado e o status da linha e
// recalculado sobre ele — e a acao MAIS destrutiva das tres (aceitar, editar,
// resolver manualmente) e era a unica sem justificativa obrigatoria. `note`
// agora exige o mesmo minimo que `resolution_note` do aceite.
export const editComparisonFieldSchema = z.object({
  rowKey: z.string().trim().min(1).max(160),
  fieldLabel: z.string().trim().min(1).max(160),
  sourceColumn: z.enum(['invoice', 'packingList', 'bl', 'espelho', 'system']),
  value: z.string().trim().max(5000).nullable(),
  note: z.string().trim().min(3).max(1000),
});

export const removeComparisonFieldSchema = z.object({
  rowKey: z.string().trim().min(1).max(160),
  sourceColumn: z.enum(['invoice', 'packingList', 'bl', 'espelho', 'system']),
  note: z.string().trim().min(3).max(1000),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type ReclassifyDocumentInput = z.infer<typeof reclassifyDocumentSchema>;
export type AcceptComparisonInput = z.infer<typeof acceptComparisonSchema>;
export type EditComparisonFieldInput = z.infer<typeof editComparisonFieldSchema>;
export type RemoveComparisonFieldInput = z.infer<typeof removeComparisonFieldSchema>;
