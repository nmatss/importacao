import { z } from 'zod';

export const auditLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
    .optional(),
});
