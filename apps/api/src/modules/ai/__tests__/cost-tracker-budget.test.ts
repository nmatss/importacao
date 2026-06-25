import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();

vi.mock('../../../shared/database/connection.js', () => ({
  db: {
    select: selectMock,
    insert: vi.fn(),
  },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

function mockSpendSequence(values: number[]) {
  selectMock.mockReset();
  for (const value of values) {
    selectMock.mockReturnValueOnce({
      from: () => ({
        where: async () => [{ total: String(value) }],
      }),
    });
  }
}

describe('assertBudgetAvailable projected-cost guard', () => {
  beforeEach(() => {
    process.env.AI_MONTHLY_BUDGET_USD = '200';
    process.env.AI_DAILY_BUDGET_BRL = '100';
    process.env.AI_BRL_PER_USD = '5';
    vi.resetModules();
  });

  it('blocks before a paid call when projected daily spend would exceed R$100', async () => {
    mockSpendSequence([
      10, // monthly spend USD
      19.99, // daily spend USD = R$99.95 at 5 BRL/USD
    ]);

    const { assertBudgetAvailable } = await import('../cost-tracker.js');

    await expect(assertBudgetAvailable({ estimatedCostUSD: 0.02 })).rejects.toThrow(
      /Orçamento diário/,
    );
  });

  it('allows a paid call when projected daily spend remains inside the cap', async () => {
    mockSpendSequence([
      10, // monthly spend USD
      19.0, // daily spend USD = R$95
    ]);

    const { assertBudgetAvailable } = await import('../cost-tracker.js');

    await expect(assertBudgetAvailable({ estimatedCostUSD: 0.05 })).resolves.toBeUndefined();
  });
});
