import { describe, it, expect, vi } from 'vitest';

// Importing service.ts bootstraps the DB connection + cost-tracker side
// effects — mock them so this pure-logic test stays isolated (same pattern as
// extract-with-upgrade.test.ts).
vi.mock('../../../shared/database/connection.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(async (fn: any) => fn({})),
  },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../cost-tracker.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    assertBudgetAvailable: vi.fn().mockResolvedValue(undefined),
    logUsage: vi.fn().mockResolvedValue(undefined),
    getMonthlySpendUSD: vi.fn().mockResolvedValue(0),
  };
});

const { isRetryableAiError } = await import('../service.js');
const { AIBudgetExceededError } = await import('../cost-pricing.js');

describe('isRetryableAiError', () => {
  it('does NOT retry 4xx provider errors (400/403/404)', () => {
    expect(isRetryableAiError(new Error('OpenRouter API error: 400 - bad request'))).toBe(false);
    expect(isRetryableAiError(new Error('OpenRouter API error: 403 - forbidden'))).toBe(false);
    expect(isRetryableAiError(new Error('Vertex API error: 404 - not found'))).toBe(false);
  });

  it('does NOT retry an exhausted monthly budget', () => {
    expect(isRetryableAiError(new AIBudgetExceededError(250, 200))).toBe(false);
  });

  it('DOES retry 5xx provider errors', () => {
    expect(isRetryableAiError(new Error('OpenRouter API error: 500 - internal'))).toBe(true);
    expect(isRetryableAiError(new Error('Vertex API error: 503 - unavailable'))).toBe(true);
  });

  it('DOES retry transient / network / timeout errors', () => {
    expect(isRetryableAiError(new Error('Operation timed out after 90000ms'))).toBe(true);
    expect(isRetryableAiError(new Error('Empty response from OpenRouter API'))).toBe(true);
    expect(isRetryableAiError(new Error('fetch failed'))).toBe(true);
  });

  it('retries unknown / non-Error values (fail open to a retry)', () => {
    expect(isRetryableAiError(undefined)).toBe(true);
    expect(isRetryableAiError('some string')).toBe(true);
  });
});
