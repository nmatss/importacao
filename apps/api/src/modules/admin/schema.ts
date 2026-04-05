import { z } from 'zod';

export const queueStatsQuerySchema = z.object({
  queue: z.string().max(100).optional(),
});
