import { z } from 'zod';

export const processIdParamSchema = z.object({
  processId: z.coerce.number().int().positive('ID do processo deve ser positivo'),
});

export const resultIdParamSchema = z.object({
  id: z.coerce.number().int().positive('ID do resultado deve ser positivo'),
});

export const resolveManuallySchema = z
  .object({
    resolutionNote: z.string().trim().min(1, 'Justificativa e obrigatoria').max(5000).optional(),
    resolution_note: z.string().trim().min(1, 'Justificativa e obrigatoria').max(5000).optional(),
    resolution: z.string().trim().min(1).max(5000).optional(),
  })
  .refine((data) => !!(data.resolutionNote || data.resolution_note), {
    message: 'Justificativa (resolutionNote) e obrigatoria',
    path: ['resolutionNote'],
  });

export const updateCorrectionSchema = z.object({
  correctionReceivedAt: z.coerce.date().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});
