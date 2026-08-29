import { z } from 'zod';
import {
  isoDateSchema,
  refineDateRange,
  dateRangeRefinement,
} from '../../shared/schemas/iso-date.js';

const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true'));

// Espelha `emailIngestionStatusEnum` em shared/database/schema.ts. O cartao de
// KPI "Falhas" agrega o dia inteiro enquanto a lista pagina de 20 em 20: sem
// filtro por status, "Falhas: 12" so mostrava as que caissem na pagina atual e
// o operador parava de procurar achando que tinha visto tudo.
export const EMAIL_INGESTION_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'ignored',
  'reprocessed',
] as const;

export const emailLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    processId: z.coerce.number().int().positive().optional(),
    processCode: z.string().min(1).max(50).optional(),
    status: z.enum(EMAIL_INGESTION_STATUSES).optional(),
    // O regex solto aceitava '2026-02-30': a data passava na validacao e depois
    // era descartada em silencio pelo service — outro filtro fantasma.
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .refine(refineDateRange, dateRangeRefinement);

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
});

export const historyScanSchema = z.object({
  months: z.coerce.number().int().min(1).max(12).default(6),
});

export const logIdParamSchema = z.object({
  logId: z.coerce.number().int().positive('ID do log deve ser positivo'),
});
