import { z } from 'zod';
import { VALID_LOGISTIC_STATUSES } from '../processes/schema.js';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data invalido (YYYY-MM-DD)');

export const sydleReportQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(120).optional(),
  processCode: z.string().trim().max(50).optional(),
  supplier: z.string().trim().max(255).optional(),
  brand: z.enum(['puket', 'imaginarium']).optional(),
  currency: z.string().trim().max(8).optional(),
  // Fase logística do processo casado (qual etapa do ciclo de importação).
  logisticStatus: z.enum(VALID_LOGISTIC_STATUSES).optional(),
  paymentStatus: z
    .enum(['open', 'scheduled', 'paid', 'overdue', 'cancelled', 'unknown'])
    .optional(),
  paymentType: z.enum(['deposit', 'balance', 'fee', 'refund', 'other']).optional(),
  matchStatus: z.enum(['matched', 'ambiguous', 'unmatched']).optional(),
  // Atalho profissional de vencimento: vencidos / vence em 7 / vence em 30 dias.
  dueBucket: z.enum(['overdue', 'due7', 'due30']).optional(),
  dueFrom: dateString.optional(),
  dueTo: dateString.optional(),
  updatedFrom: dateString.optional(),
  updatedTo: dateString.optional(),
  sortBy: z
    .enum([
      'dueDate',
      'sourceUpdatedAt',
      'purchaseAmount',
      'paidAmount',
      'openAmount',
      'supplierName',
    ])
    .default('dueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const syncRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SydleReportQuery = z.infer<typeof sydleReportQuerySchema>;
export type SyncRunsQuery = z.infer<typeof syncRunsQuerySchema>;
