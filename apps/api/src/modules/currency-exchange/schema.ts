import { z } from 'zod';

export const createCurrencyExchangeSchema = z.object({
  processId: z.number({ required_error: 'ID do processo obrigatório' }),
  type: z.enum(['balance', 'deposit']),
  amountUsd: z.union([z.string(), z.number()]).transform(String),
  exchangeRate: z.union([z.string(), z.number()]).transform(String).optional(),
  amountBrl: z.union([z.string(), z.number()]).transform(String).optional(),
  paymentDeadline: z.string().optional(),
  expirationDate: z.string().optional(),
  notes: z.string().optional(),
});

export const updateCurrencyExchangeSchema = z.object({
  type: z.enum(['balance', 'deposit']).optional(),
  amountUsd: z.union([z.string(), z.number()]).transform(String).optional(),
  exchangeRate: z.union([z.string(), z.number()]).transform(String).optional(),
  amountBrl: z.union([z.string(), z.number()]).transform(String).optional(),
  paymentDeadline: z.string().optional(),
  expirationDate: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateCurrencyExchangeInput = z.infer<typeof createCurrencyExchangeSchema>;
export type UpdateCurrencyExchangeInput = z.infer<typeof updateCurrencyExchangeSchema>;
