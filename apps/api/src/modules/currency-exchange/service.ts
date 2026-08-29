import { eq, sql, desc } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { alertService } from '../alerts/service.js';
import { currencyExchanges, importProcesses } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import type { CreateCurrencyExchangeInput, UpdateCurrencyExchangeInput } from './schema.js';

function calculateBrl(amountUsd: string, exchangeRate?: string): string | undefined {
  if (!exchangeRate) return undefined;
  return (parseFloat(amountUsd) * parseFloat(exchangeRate)).toFixed(2);
}

export const currencyExchangeService = {
  async list(processId: number) {
    return db
      .select()
      .from(currencyExchanges)
      .where(eq(currencyExchanges.processId, processId))
      .orderBy(desc(currencyExchanges.createdAt))
      .limit(100);
  },

  async create(input: CreateCurrencyExchangeInput) {
    const amountBrl = input.amountBrl ?? calculateBrl(input.amountUsd, input.exchangeRate);

    const [exchange] = await db
      .insert(currencyExchanges)
      .values({
        processId: input.processId,
        type: input.type,
        amountUsd: input.amountUsd,
        exchangeRate: input.exchangeRate,
        amountBrl,
        paymentDeadline: input.paymentDeadline,
        expirationDate: input.expirationDate,
        notes: input.notes,
      })
      .returning();

    return exchange;
  },

  async update(id: number, input: UpdateCurrencyExchangeInput) {
    const [existing] = await db
      .select()
      .from(currencyExchanges)
      .where(eq(currencyExchanges.id, id))
      .limit(1);

    if (!existing) throw new Error('Câmbio não encontrado');

    const amountUsd = input.amountUsd ?? existing.amountUsd;
    const exchangeRate = input.exchangeRate ?? existing.exchangeRate;
    const amountBrl = input.amountBrl ?? calculateBrl(amountUsd, exchangeRate ?? undefined);

    const [exchange] = await db
      .update(currencyExchanges)
      .set({
        ...input,
        amountBrl,
      })
      .where(eq(currencyExchanges.id, id))
      .returning();

    return exchange;
  },

  async delete(id: number) {
    const [exchange] = await db
      .delete(currencyExchanges)
      .where(eq(currencyExchanges.id, id))
      .returning({ id: currencyExchanges.id });

    if (!exchange) throw new Error('Câmbio não encontrado');
    return exchange;
  },

  async autoPopulate(processId: number, invoiceData: Record<string, any>) {
    // Skip if currency exchanges already exist for this process
    const existing = await db
      .select()
      .from(currencyExchanges)
      .where(eq(currencyExchanges.processId, processId));

    if (existing.length > 0) {
      logger.debug({ processId }, 'Currency exchanges already exist, skipping auto-populate');
      return existing;
    }

    const totalFob = Number(invoiceData.totalFobValue ?? 0);
    if (!totalFob) {
      logger.warn({ processId }, 'No totalFobValue found, cannot auto-populate currency exchanges');
      return [];
    }

    const paymentTerms = invoiceData.paymentTerms;
    const depositPercent = Number(paymentTerms?.depositPercent ?? 0);
    const balancePercent = Number(paymentTerms?.balancePercent ?? 0);

    const created: any[] = [];

    if (depositPercent > 0) {
      const depositAmount = ((totalFob * depositPercent) / 100).toFixed(2);
      const deposit = await this.create({
        processId,
        type: 'deposit',
        amountUsd: depositAmount,
        notes: `Auto: ${depositPercent}% deposit${paymentTerms?.description ? ` - ${paymentTerms.description}` : ''}`,
      });
      created.push(deposit);
    }

    if (balancePercent > 0) {
      const balanceAmount = ((totalFob * balancePercent) / 100).toFixed(2);
      const balance = await this.create({
        processId,
        type: 'balance',
        amountUsd: balanceAmount,
        notes: `Auto: ${balancePercent}% balance${paymentTerms?.description ? ` - ${paymentTerms.description}` : ''}`,
      });
      created.push(balance);
    }

    // Cronograma incompleto NAO pode ficar silencioso.
    // Com deposit 30% e balance nao extraido, o codigo criava um unico registro
    // de 30% e os outros 70% do valor simplesmente nao existiam — sem log, sem
    // alerta, e a tela de cambios exibia o cronograma como se estivesse
    // completo. Os registros extraidos continuam sendo criados (sao dado real),
    // mas a lacuna passa a ser anunciada.
    const declaredPercent = depositPercent + balancePercent;
    if (declaredPercent > 0 && Math.abs(declaredPercent - 100) > 0.01) {
      logger.warn(
        { processId, depositPercent, balancePercent, declaredPercent },
        'Termos de pagamento incompletos: cronograma de cambio parcial',
      );
      await alertService.create({
        processId,
        severity: 'warning',
        title: 'Cronograma de câmbio incompleto',
        message:
          `Os termos de pagamento extraídos somam ${declaredPercent}%, não 100%. ` +
          `Foram gerados apenas os lançamentos identificados (adiantamento ${depositPercent}%, ` +
          `saldo ${balancePercent}%). Complete o cronograma manualmente antes de usá-lo ` +
          'para conferência financeira.',
      });
    }

    // If no payment terms found, create a single balance for full amount
    if (depositPercent === 0 && balancePercent === 0) {
      const balance = await this.create({
        processId,
        type: 'balance',
        amountUsd: totalFob.toFixed(2),
        notes: 'Auto: termos de pagamento não identificados - valor total como balance',
      });
      created.push(balance);
    }

    // Save payment terms to process
    if (paymentTerms) {
      await db
        .update(importProcesses)
        .set({ paymentTerms, updatedAt: new Date() })
        .where(eq(importProcesses.id, processId));
    }

    logger.info(
      { processId, count: created.length, depositPercent, balancePercent },
      'Currency exchanges auto-populated',
    );
    return created;
  },

  async getByProcess(processId: number) {
    const exchanges = await db
      .select()
      .from(currencyExchanges)
      .where(eq(currencyExchanges.processId, processId));

    const [totals] = await db
      .select({
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
