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
  includeRead: z.coerce.boolean().optional().default(false),
  after: z
    .string()
    .regex(/^\d{4}\/\d{2}\/\d{2}$/, 'Formato inválido (YYYY/MM/DD)')
    .optional(),
  before: z
    .string()
    .regex(/^\d{4}\/\d{2}\/\d{2}$/, 'Formato inválido (YYYY/MM/DD)')
    .optional(),
  q: z
    .string()
    .max(500)
    .regex(/^[^{}()|&;$`]*$/, 'Query Gmail inválida')
    .optional(),
  allSenders: z.coerce.boolean().optional().default(false),
});

export const historyScanSchema = z.object({
  months: z.coerce.number().int().min(1).max(12).default(6),
  allSenders: z.coerce.boolean().optional().default(false),
});

export const logIdParamSchema = z.object({
  logId: z.coerce.number().int().positive('ID do log deve ser positivo'),
});
