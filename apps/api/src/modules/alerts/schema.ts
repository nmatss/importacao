import { z } from 'zod';
import {
  isoDateSchema,
  refineDateRange,
  dateRangeRefinement,
} from '../../shared/schemas/iso-date.js';

export const createAlertSchema = z.object({
  processId: z.number().optional(),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string().min(1, 'Título obrigatório'),
  message: z.string().min(1, 'Mensagem obrigatória'),
});

/**
 * Query da listagem. Precisa cobrir TODO parametro lido pelo controller:
 * `validate(schema, 'query')` substitui `req.query` pelo resultado do Zod e
 * `z.object()` descarta chave desconhecida — um campo esquecido aqui vira um
 * filtro fantasma, aceito pela tela e silenciosamente ignorado pela API.
 */
export const alertsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    processId: z.coerce.number().int().positive().optional(),
    severity: z.enum(['info', 'warning', 'critical']).optional(),
    acknowledged: z.enum(['true', 'false']).optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .refine(refineDateRange, dateRangeRefinement);
