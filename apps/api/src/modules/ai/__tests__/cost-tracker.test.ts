import { describe, it, expect } from 'vitest';
import { estimateCostUSD, AIBudgetExceededError } from '../cost-pricing.js';

describe('estimateCostUSD', () => {
  it('prices Flash @ $0.30/1M input + $2.50/1M output (official GA rates)', () => {
    expect(estimateCostUSD('gemini-2.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 5);
  });

  it('prices Pro @ $1.25/1M input + $10.00/1M output (≤200k tier)', () => {
    expect(estimateCostUSD('gemini-2.5-pro', 1_000_000, 1_000_000)).toBeCloseTo(11.25, 5);
  });

  it('handles "google/" prefix the same as bare name', () => {
    const a = estimateCostUSD('gemini-2.5-flash', 5_000, 2_000);
    const b = estimateCostUSD('google/gemini-2.5-flash', 5_000, 2_000);
    expect(a).toBe(b);
  });

  it('returns 0 for unknown models (cost tracking gracefully skips)', () => {
    expect(estimateCostUSD('unknown-model-xyz', 1000, 1000)).toBe(0);
  });

  it('typical-document cost is roughly $0.0065 (Flash, 5k in / 2k out)', () => {
    // (5000*0.30 + 2000*2.50) / 1e6 = 0.0065
    const cost = estimateCostUSD('gemini-2.5-flash', 5_000, 2_000);
    expect(cost).toBeCloseTo(0.0065, 5);
  });

  it('Pro-upgrade cost on a worst-case (10k in / 4k out) stays under $0.06', () => {
    const cost = estimateCostUSD('gemini-2.5-pro', 10_000, 4_000);
    expect(cost).toBeLessThan(0.06);
  });
});

describe('AIBudgetExceededError', () => {
  it('has statusCode 429 and a human-readable PT-BR message', () => {
    const err = new AIBudgetExceededError(220, 200);
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('Orçamento mensal');
    expect(err.message).toContain('220');
    expect(err.message).toContain('200');
  });

  it('supports a daily (diário) period with the daily env var hint', () => {
    const err = new AIBudgetExceededError(20, 18.5, 'diário');
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('Orçamento diário');
    expect(err.message).toContain('AI_DAILY_BUDGET_BRL');
    expect(err.message).toContain('amanhã');
  });
});
