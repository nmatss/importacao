/**
 * Pure cost calculation — no DB, no env coupling. Lives separate from
 * cost-tracker.ts so tests can exercise pricing without bootstrapping the
 * database connection.
 */

// Pricing in USD per 1M tokens — official Vertex AI / Gemini API GA rates
// (verified 2026-06, https://cloud.google.com/vertex-ai/generative-ai/pricing
// and https://ai.google.dev/gemini-api/docs/pricing). Both paid providers route
// to Google Gemini, so pricing is shared.
//
// These are a HARD daily/monthly cost cap, so accuracy matters in the SAFE
// direction: NEVER under-price, or real Vertex spend can blow past R$100/day
// before the gate fires. Where a model has a higher tier above 200k tokens
// (2.5 Pro: 2.50/15.00), we keep the ≤200k rate because every extraction prompt
// here is far under 200k — but the pre-flight estimate (service.ts) is itself
// conservative (assumes the max output cap), so the gate still errs toward
// capping early rather than overspending.
export const MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.3, output: 2.5 }, // GA rate (was 0.15/0.60 preview — output was 4x under-priced)
  'gemini-2.5-pro': { input: 1.25, output: 10.0 }, // ≤200k tier; >200k would be 2.50/15.00
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
};

export class AIBudgetExceededError extends Error {
  readonly statusCode = 429;
  constructor(spentUSD: number, budgetUSD: number, period: 'mensal' | 'diário' = 'mensal') {
    const envVar = period === 'diário' ? 'AI_DAILY_BUDGET_BRL' : 'AI_MONTHLY_BUDGET_USD';
    const wait = period === 'diário' ? 'aguarde amanhã' : 'aguarde o próximo mês';
    super(
      `Orçamento ${period} de IA esgotado: gasto $${spentUSD.toFixed(2)} >= limite $${budgetUSD.toFixed(2)}. Aumente ${envVar} ou ${wait}.`,
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
