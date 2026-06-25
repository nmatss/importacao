import { sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { aiUsageLog } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import { alertService } from '../alerts/service.js';
import { AIBudgetExceededError, estimateCostUSD } from './cost-pricing.js';

export { AIBudgetExceededError, estimateCostUSD };

/**
 * AI cost tracking + monthly budget cap.
 *
 * Why: Nicolas (2026-05-22): "limitar o custo do vertex até 1000 reais/mês".
 * USD 200 ≈ R$ 1000 at a conservative 5 BRL/USD rate. Configurable via
 * AI_MONTHLY_BUDGET_USD (set to 0 to disable the cap entirely).
 *
 * Strategy:
 *  - Track every successful chat call in ai_usage_log (input/output tokens,
 *    computed USD cost).
 *  - Before each call, sum spend for the current calendar month (UTC) and
 *    refuse if we're over budget. Refusal throws AIBudgetExceededError which
 *    the caller can catch + fall back gracefully (currently surfaces as a
 *    503-style failure that the extraction pipeline already handles via the
 *    confidence-score < 0.4 alert path).
 *  - Send a single warning alert when crossing 80% of the budget in a month.
 */

/**
 * Sum of cost_usd in the current Brazil-time month (America/Sao_Paulo).
 * Returns 0 when the log table is empty or unreachable (we don't fail-closed
 * — letting the call through is safer than blocking the whole extraction
 * pipeline due to DB hiccups). Using BRT instead of UTC matches Nicolas's
 * mental model of "este mês" matching the calendar he sees.
 */
export async function getMonthlySpendUSD(): Promise<number> {
  try {
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
      })
      .from(aiUsageLog)
      .where(
        sql`${aiUsageLog.createdAt} >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`,
      );
    const value = Number(rows[0]?.total ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch (err) {
    logger.error({ err }, 'getMonthlySpendUSD failed — assuming 0 to avoid blocking calls');
    return 0;
  }
}

/**
 * Soma de cost_usd do DIA corrente (America/Sao_Paulo). Base do teto diario em
 * R$ (Nicolas 2026-06-22). Mesmo fail-open do mensal: 0 em erro de BD.
 */
export async function getDailySpendUSD(): Promise<number> {
  try {
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
      })
      .from(aiUsageLog)
      .where(
        sql`${aiUsageLog.createdAt} >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')`,
      );
    const value = Number(rows[0]?.total ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch (err) {
    logger.error({ err }, 'getDailySpendUSD failed — assuming 0 to avoid blocking calls');
    return 0;
  }
}

/**
 * Throws AIBudgetExceededError when the monthly cap has been hit.
 * Also sends an 80%-threshold warning alert (idempotent per day via
 * alert title fingerprint — alertService handles dedup).
 */
export async function assertBudgetAvailable(
  options: { estimatedCostUSD?: number } = {},
): Promise<void> {
  const estimatedCostUSD = Math.max(0, Number(options.estimatedCostUSD ?? 0) || 0);

  // ── Teto MENSAL (USD) — AI_MONTHLY_BUDGET_USD (0 desativa). ──
  const monthlyBudgetUSD = Number(process.env.AI_MONTHLY_BUDGET_USD ?? '200');
  if (Number.isFinite(monthlyBudgetUSD) && monthlyBudgetUSD > 0) {
    const spent = await getMonthlySpendUSD();
    const projected = spent + estimatedCostUSD;
    if (projected >= monthlyBudgetUSD) {
      throw new AIBudgetExceededError(projected, monthlyBudgetUSD, 'mensal');
    }
    if (spent >= monthlyBudgetUSD * 0.8) {
      const today = new Date().toISOString().slice(0, 10);
      alertService
        .create({
          severity: 'warning',
          title: `IA: 80% do orçamento mensal consumido (${today})`,
          message: `Gasto até agora: $${spent.toFixed(2)} de $${monthlyBudgetUSD.toFixed(2)} (≈ R$ ${(spent * 5).toFixed(0)} de R$ ${(monthlyBudgetUSD * 5).toFixed(0)}). Acompanhe o consumo em /api/ai/usage ou suspenda novas extrações ajustando AI_MONTHLY_BUDGET_USD=0 temporariamente.`,
        })
        .catch((err) => logger.warn({ err }, 'Failed to create 80%-budget alert (dedup expected)'));
    }
  }

  // ── Teto DIÁRIO (R$) — Nicolas 2026-06-22: "limitar o uso por dia de 100 reais". ──
  // O custo é rastreado em USD; convertemos o limite em R$ via AI_BRL_PER_USD
  // (default 5, a mesma taxa conservadora do teto mensal). AI_DAILY_BUDGET_BRL=0
  // desativa. A IA local é grátis (custo 0), então este teto só morde providers
  // pagos (Vertex/OpenRouter) — é a trava de custo antes de ligar o Vertex.
  const dailyBudgetBRL = Number(process.env.AI_DAILY_BUDGET_BRL ?? '100');
  const brlPerUsd = Number(process.env.AI_BRL_PER_USD ?? '5');
  if (
    Number.isFinite(dailyBudgetBRL) &&
    dailyBudgetBRL > 0 &&
    Number.isFinite(brlPerUsd) &&
    brlPerUsd > 0
  ) {
    const dailyBudgetUSD = dailyBudgetBRL / brlPerUsd;
    const spentTodayUSD = await getDailySpendUSD();
    const projectedTodayUSD = spentTodayUSD + estimatedCostUSD;
    if (projectedTodayUSD >= dailyBudgetUSD) {
      throw new AIBudgetExceededError(projectedTodayUSD, dailyBudgetUSD, 'diário');
    }
    if (spentTodayUSD >= dailyBudgetUSD * 0.8) {
      const today = new Date().toISOString().slice(0, 10);
      const spentBRL = spentTodayUSD * brlPerUsd;
      alertService
        .create({
          severity: 'warning',
          title: `IA: 80% do teto diário consumido (${today})`,
          message: `Gasto hoje: ≈ R$ ${spentBRL.toFixed(0)} de R$ ${dailyBudgetBRL.toFixed(0)} (limite diário). Novas extrações serão bloqueadas ao atingir o teto; ele reseta amanhã. Ajuste AI_DAILY_BUDGET_BRL para mudar.`,
        })
        .catch((err) =>
          logger.warn({ err }, 'Failed to create 80%-daily-budget alert (dedup expected)'),
        );
    }
  }
}

/**
 * Persist a usage event. Failure to write is logged but does NOT throw —
 * we never want logging to break the extraction itself.
 */
export async function logUsage(params: {
  provider: 'openrouter' | 'vertex' | 'ialocal';
  model: string;
  context: string;
  inputTokens: number;
  outputTokens: number;
  status?: 'success' | 'error';
}): Promise<void> {
  const cost = estimateCostUSD(params.model, params.inputTokens, params.outputTokens);
  try {
    await db.insert(aiUsageLog).values({
      provider: params.provider,
      model: params.model,
      context: params.context.slice(0, 100),
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: cost.toFixed(6),
      status: params.status ?? 'success',
    });
  } catch (err) {
    logger.error(
      { err, model: params.model, cost },
      'Failed to persist AI usage — budget cap may drift',
    );
  }
}

/**
 * Summary for the /api/ai/usage admin endpoint.
 */
export async function getUsageSummary(): Promise<{
  monthlySpendUSD: number;
  budgetUSD: number;
  budgetPctUsed: number;
  dailySpendUSD: number;
  dailySpendBRL: number;
  dailyBudgetBRL: number;
  dailyBudgetUSD: number;
  dailyPctUsed: number;
  byModel: Array<{
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}> {
  const budgetUSD = Number(process.env.AI_MONTHLY_BUDGET_USD ?? '200');
  const monthlySpendUSD = await getMonthlySpendUSD();

  const dailyBudgetBRL = Number(process.env.AI_DAILY_BUDGET_BRL ?? '100');
  const brlPerUsd = Number(process.env.AI_BRL_PER_USD ?? '5');
  const dailyBudgetUSD = brlPerUsd > 0 ? dailyBudgetBRL / brlPerUsd : 0;
  const dailySpendUSD = await getDailySpendUSD();

  const byModelRaw = await db
    .select({
      model: aiUsageLog.model,
      calls: sql<string>`COUNT(*)`,
      inputTokens: sql<string>`COALESCE(SUM(${aiUsageLog.inputTokens}), 0)`,
      outputTokens: sql<string>`COALESCE(SUM(${aiUsageLog.outputTokens}), 0)`,
      costUsd: sql<string>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)`,
    })
    .from(aiUsageLog)
    .where(
      sql`${aiUsageLog.createdAt} >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`,
    )
    .groupBy(aiUsageLog.model);

  return {
    monthlySpendUSD,
    budgetUSD,
    budgetPctUsed: budgetUSD > 0 ? (monthlySpendUSD / budgetUSD) * 100 : 0,
    dailySpendUSD,
    dailySpendBRL: dailySpendUSD * brlPerUsd,
    dailyBudgetBRL,
    dailyBudgetUSD,
    dailyPctUsed: dailyBudgetUSD > 0 ? (dailySpendUSD / dailyBudgetUSD) * 100 : 0,
    byModel: byModelRaw.map((r) => ({
      model: r.model,
      calls: Number(r.calls),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd: Number(r.costUsd),
    })),
  };
}
