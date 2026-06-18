import { z } from 'zod';

const positiveDecimalString = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => Number(value) > 0, `${label} deve ser maior que zero`);

function validateExchangeDates(
  data: { paymentDeadline?: string; expirationDate?: string },
  ctx: z.RefinementCtx,
) {
  if (data.paymentDeadline && data.expirationDate && data.expirationDate < data.paymentDeadline) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expirationDate'],
      message: 'Data de expiração não pode ser anterior ao vencimento',
    });
  }
}

export const createCurrencyExchangeSchema = z
  .object({
    processId: z.coerce.number({ required_error: 'ID do processo obrigatório' }).int().positive(),
    type: z.enum(['balance', 'deposit']),
    amountUsd: positiveDecimalString('Valor USD'),
    exchangeRate: positiveDecimalString('Taxa de câmbio').optional(),
    amountBrl: positiveDecimalString('Valor BRL').optional(),
    paymentDeadline: z.string().optional(),
    expirationDate: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine(validateExchangeDates);

export const updateCurrencyExchangeSchema = z
  .object({
    type: z.enum(['balance', 'deposit']).optional(),
    amountUsd: positiveDecimalString('Valor USD').optional(),
    exchangeRate: positiveDecimalString('Taxa de câmbio').optional(),
    amountBrl: positiveDecimalString('Valor BRL').optional(),
    paymentDeadline: z.string().optional(),
    expirationDate: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine(validateExchangeDates);

export type CreateCurrencyExchangeInput = z.infer<typeof createCurrencyExchangeSchema>;
export type UpdateCurrencyExchangeInput = z.infer<typeof updateCurrencyExchangeSchema>;
