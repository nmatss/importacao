import { z } from 'zod';

export const getPreConsItemsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  processCode: z.string().trim().optional(),
  sheetName: z.string().trim().optional(),
  search: z.string().trim().optional(),
  supplier: z.string().trim().optional(),
  etdFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data invalido (YYYY-MM-DD)')
    .optional(),
  etdTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data invalido (YYYY-MM-DD)')
    .optional(),
  sortBy: z.enum(['processCode', 'supplier', 'etd', 'amount', 'quantity']).default('processCode'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type GetPreConsItemsInput = z.infer<typeof getPreConsItemsSchema>;
