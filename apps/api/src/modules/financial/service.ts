import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses } from '../../shared/database/schema.js';
import { currencyExchangeService } from '../currency-exchange/service.js';
import { auditService } from '../audit/service.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { logger } from '../../shared/utils/logger.js';
import { buildFinancialSnapshot, type FinancialSnapshot } from './calculations.js';

export interface ProcessFinancialSnapshot extends FinancialSnapshot {
  processId: number;
  processCode: string;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const financialService = {
  /**
   * Taxa USD→BRL do processo: registro de câmbio mais recente com taxa
   * preenchida (módulo currency-exchange). Retorna null quando não há —
   * nesse caso o snapshot fica em USD e nada é persistido em BRL.
   */
  async resolveExchangeRate(processId: number): Promise<number | null> {
    const exchanges = await currencyExchangeService.list(processId); // já ordenado desc por createdAt
    for (const exchange of exchanges) {
      const rate = toNumber(exchange.exchangeRate);
      if (rate !== null && rate > 0) return rate;
    }
    return null;
  },

  /** Snapshot financeiro on-demand (não persiste nada). */
  async getSnapshot(processId: number): Promise<ProcessFinancialSnapshot> {
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!process) throw new NotFoundError('Processo não encontrado');

    const exchangeRate = await this.resolveExchangeRate(processId);

    const snapshot = buildFinancialSnapshot({
      fobValueUsd: toNumber(process.totalFobValue),
      freightValueUsd: toNumber(process.freightValue),
      insuranceValueUsd: toNumber(process.insuranceValue),
      exchangeRate,
      freeTimeDays: process.freeTimeDays,
      // Início do free time: descarga real quando houver, senão ETA prevista
      dischargeDate: process.etaActual ?? process.eta,
    });

    return {
      processId: process.id,
      processCode: process.processCode,
      ...snapshot,
    };
  },

  /**
   * Recalcula e persiste numerário (numerario_value/numerario_pct).
   * Sem taxa USD→BRL (ou sem FOB) nada é gravado — evita persistir BRL errado.
   */
  async recompute(processId: number, userId: number | null) {
    const snapshot = await this.getSnapshot(processId);

    if (!snapshot.numerario) {
      const reason = snapshot.exchangeRate === null ? 'missing_exchange_rate' : 'missing_fob_value';
      logger.warn({ processId, reason }, 'Financial recompute skipped persistence');
      auditService.log(
        userId,
        'financial_recompute',
        'process',
        processId,
        { persisted: false, reason, missing: snapshot.missing },
        null,
      );
      return { ...snapshot, persisted: false as const, reason };
    }

    await db
      .update(importProcesses)
      .set({
        numerarioValue: snapshot.numerario.numerarioValue.toFixed(2),
        numerarioPct: snapshot.numerario.numerarioPct.toFixed(4),
        updatedAt: new Date(),
      })
      .where(eq(importProcesses.id, processId));

    auditService.log(
      userId,
      'financial_recompute',
      'process',
      processId,
      {
        persisted: true,
        numerarioValue: snapshot.numerario.numerarioValue,
        numerarioPct: snapshot.numerario.numerarioPct,
        customsValueUsd: snapshot.customsValueUsd,
        customsValueBrl: snapshot.customsValueBrl,
        exchangeRate: snapshot.exchangeRate,
      },
      null,
    );

    logger.info(
      { processId, numerarioValue: snapshot.numerario.numerarioValue },
      'Financial recompute persisted',
    );

    return { ...snapshot, persisted: true as const };
  },
};
