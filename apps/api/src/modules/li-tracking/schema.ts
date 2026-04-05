import { z } from 'zod';

export const createLiTrackingSchema = z.object({
  processId: z.number().optional(),
  processCode: z.string({ required_error: 'Codigo do processo obrigatorio' }),
  orgao: z.string().optional(),
  ncm: z.string().optional(),
  item: z.string().optional(),
  description: z.string().optional(),
  supplier: z.string().optional(),
  requestedByCompanyAt: z.string().optional(),
  submittedToFeniciaAt: z.string().optional(),
  deferredAt: z.string().optional(),
  expectedDeferralAt: z.string().optional(),
  averageDays: z.number().optional(),
  validUntil: z.string().optional(),
  lpcoNumber: z.string().optional(),
  etdOrigem: z.string().optional(),
  etaArmador: z.string().optional(),
  status: z
    .enum(['pending', 'requested', 'submitted', 'deferred', 'expired', 'cancelled'])
    .optional(),
  itemStatus: z.string().optional(),
  observations: z.string().optional(),
});

export const updateLiTrackingSchema = z.object({
  processId: z.number().optional(),
  processCode: z.string().optional(),
  orgao: z.string().optional(),
  ncm: z.string().optional(),
  item: z.string().optional(),
  description: z.string().optional(),
  supplier: z.string().optional(),
  requestedByCompanyAt: z.string().nullable().optional(),
  submittedToFeniciaAt: z.string().nullable().optional(),
  deferredAt: z.string().nullable().optional(),
  expectedDeferralAt: z.string().nullable().optional(),
  averageDays: z.number().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  lpcoNumber: z.string().nullable().optional(),
  etdOrigem: z.string().nullable().optional(),
  etaArmador: z.string().nullable().optional(),
  status: z
    .enum(['pending', 'requested', 'submitted', 'deferred', 'expired', 'cancelled'])
    .optional(),
  itemStatus: z.string().nullable().optional(),
  observations: z.string().nullable().optional(),
});

export const liTrackingQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z
    .enum(['pending', 'requested', 'submitted', 'deferred', 'expired', 'cancelled'])
    .optional(),
  processCode: z.string().max(100).optional(),
});

export const liTrackingIdParamSchema = z.object({
  id: z.coerce.number().int().positive('ID deve ser positivo'),
});

export type CreateLiTrackingInput = z.infer<typeof createLiTrackingSchema>;
export type UpdateLiTrackingInput = z.infer<typeof updateLiTrackingSchema>;
