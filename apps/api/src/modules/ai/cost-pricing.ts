/**
 * Pure cost calculation — no DB, no env coupling. Lives separate from
 * cost-tracker.ts so tests can exercise pricing without bootstrapping the
 * database connection.
 */

// Pricing in USD per 1M tokens (2026 published rates — verify against
// cloud.google.com/vertex-ai/generative-ai/pricing periodically). Both
// providers route to Google Gemini under the hood, so pricing is shared.
// Conservative: we use the higher tier (>200k input context) since real
// document extractions can spill into that range. Underestimating here
// means the budget cap fires LATER than expected — preferable to never.
export const MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
};

export class AIBudgetExceededError extends Error {
  readonly statusCode = 429;
  constructor(spentUSD: number, budgetUSD: number) {
    super(
      `Orçamento mensal de IA esgotado: gasto $${spentUSD.toFixed(2)} >= limite $${budgetUSD.toFixed(2)}. Aumente AI_MONTHLY_BUDGET_USD ou aguarde o próximo mês.`,
    );
    this.name = 'AIBudgetExceededError';
  }
}

function priceKey(model: string): string {
  return model.replace(/^google\//, '');
}

export function estimateCostUSD(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING_USD_PER_1M[priceKey(model)];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
