import { z } from 'zod';
import {
  isoDateSchema,
  refineDateRange,
  dateRangeRefinement,
} from '../../shared/schemas/iso-date.js';

const dateOrTimestamp = z.union([z.string(), z.date()]).nullable().optional();

export const updateFollowUpSchema = z.object({
  documentsReceivedAt: dateOrTimestamp,
  preInspectionAt: dateOrTimestamp,
  ncmVerifiedAt: dateOrTimestamp,
  espelhoGeneratedAt: dateOrTimestamp,
  sentToFeniciaAt: dateOrTimestamp,
  liSubmittedAt: dateOrTimestamp,
  liApprovedAt: dateOrTimestamp,
  liDeadline: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Query de `GET /api/follow-up`. Cobre todo parametro lido pelo controller —
 * `validate(schema, 'query')` descarta o que nao estiver declarado aqui.
 */
export const followUpQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    // A tela de follow-up pede `limit=200` e hoje recebe 100, porque o
    // controller ja aplica `Math.min(limit, 100)`. Um `.max(100)` aqui
    // transformaria esse pedido em HTTP 400 e quebraria a tela: o teto vira
    // recorte, igual ao comportamento atual.
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .default(20)
      .transform((value) => Math.min(value, 100)),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .refine(refineDateRange, dateRangeRefinement);
