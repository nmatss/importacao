import { z } from 'zod';

export const processIdParamSchema = z.object({
  processId: z.coerce.number().int().positive('ID do processo deve ser positivo'),
});

export const resultIdParamSchema = z.object({
  id: z.coerce.number().int().positive('ID do resultado deve ser positivo'),
});

export const updateCorrectionSchema = z.object({
  correctionReceivedAt: z.coerce.date().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});
