import { eq, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { currencyExchanges } from '../../shared/database/schema.js';
import type { CreateCurrencyExchangeInput, UpdateCurrencyExchangeInput } from './schema.js';

function calculateBrl(amountUsd: string, exchangeRate?: string): string | undefined {
  if (!exchangeRate) return undefined;
  return (parseFloat(amountUsd) * parseFloat(exchangeRate)).toFixed(2);
}

export const currencyExchangeService = {
  async list(processId: number) {
    return db.select()
      .from(currencyExchanges)
      .where(eq(currencyExchanges.processId, processId));
  },

  async create(input: CreateCurrencyExchangeInput) {
    const amountBrl = input.amountBrl ?? calculateBrl(input.amountUsd, input.exchangeRate);

    const [exchange] = await db.insert(currencyExchanges).values({
      processId: input.processId,
      type: input.type,
      amountUsd: input.amountUsd,
      exchangeRate: input.exchangeRate,
      amountBrl,
      paymentDeadline: input.paymentDeadline,
      expirationDate: input.expirationDate,
      notes: input.notes,
    }).returning();

    return exchange;
  },

  async update(id: number, input: UpdateCurrencyExchangeInput) {
    const [existing] = await db.select()
      .from(currencyExchanges)
      .where(eq(currencyExchanges.id, id))
      .limit(1);

    if (!existing) throw new Error('Câmbio não encontrado');

    const amountUsd = input.amountUsd ?? existing.amountUsd;
    const exchangeRate = input.exchangeRate ?? existing.exchangeRate;
    const amountBrl = input.amountBrl ?? calculateBrl(amountUsd, exchangeRate ?? undefined);

    const [exchange] = await db.update(currencyExchanges)
      .set({
        ...input,
        amountBrl,
      })
      .where(eq(currencyExchanges.id, id))
      .returning();

    return exchange;
  },

  async delete(id: number) {
    const [exchange] = await db.delete(currencyExchanges)
      .where(eq(currencyExchanges.id, id))
      .returning({ id: currencyExchanges.id });

    if (!exchange) throw new Error('Câmbio não encontrado');
    return exchange;
  },

  async getByProcess(processId: number) {
    const exchanges = await db.select()
      .from(currencyExchanges)
      .where(eq(currencyExchanges.processId, processId));

    const [totals] = await db.select({
      totalBalanceUsd: sql<string>`COALESCE(SUM(CASE WHEN ${currencyExchanges.type} = 'balance' THEN ${currencyExchanges.amountUsd} ELSE 0 END), 0)`,
      totalBalanceBrl: sql<string>`COALESCE(SUM(CASE WHEN ${currencyExchanges.type} = 'balance' THEN ${currencyExchanges.amountBrl} ELSE 0 END), 0)`,
      totalDepositUsd: sql<string>`COALESCE(SUM(CASE WHEN ${currencyExchanges.type} = 'deposit' THEN ${currencyExchanges.amountUsd} ELSE 0 END), 0)`,
      totalDepositBrl: sql<string>`COALESCE(SUM(CASE WHEN ${currencyExchanges.type} = 'deposit' THEN ${currencyExchanges.amountBrl} ELSE 0 END), 0)`,
    })
      .from(currencyExchanges)
      .where(eq(currencyExchanges.processId, processId));

    return { exchanges, totals };
  },
};
