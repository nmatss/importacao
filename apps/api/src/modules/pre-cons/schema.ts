import { z } from 'zod';

export const getPreConsItemsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  processCode: z.string().trim().optional(),
  sheetName: z.string().trim().optional(),
});

export type GetPreConsItemsInput = z.infer<typeof getPreConsItemsSchema>;
