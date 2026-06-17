import { z } from 'zod';

const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true'));

export const emailLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  processId: z.coerce.number().int().positive().optional(),
  processCode: z.string().min(1).max(50).optional(),
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
  includeRead: queryBoolean.optional().default(false),
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
  allSenders: queryBoolean.optional().default(false),
});

export const historyScanSchema = z.object({
  months: z.coerce.number().int().min(1).max(12).default(6),
  allSenders: queryBoolean.optional().default(false),
});

export const logIdParamSchema = z.object({
  logId: z.coerce.number().int().positive('ID do log deve ser positivo'),
});
