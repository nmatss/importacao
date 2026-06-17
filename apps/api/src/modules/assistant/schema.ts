import { z } from 'zod';

export const assistantQuerySchema = z.object({
  question: z.string().trim().min(3, 'Pergunta muito curta').max(1000, 'Pergunta muito longa'),
  processId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(3).max(20).default(10).optional(),
});

export type AssistantQueryInput = z.infer<typeof assistantQuerySchema>;
