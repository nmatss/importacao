import { z } from 'zod';

export const emailLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
    .optional(),
});

export const triggerCheckSchema = z.object({
  includeRead: z.boolean().optional().default(false),
  query: z.string().max(500).optional(),
});

export const historyScanSchema = z.object({
  daysBack: z.coerce.number().int().min(1).max(365).default(30),
  query: z.string().max(500).optional(),
});

export const logIdParamSchema = z.object({
  logId: z.coerce.number().int().positive('ID do log deve ser positivo'),
});
