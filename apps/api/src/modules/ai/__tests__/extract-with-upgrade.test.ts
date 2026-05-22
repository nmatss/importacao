import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the DB connection so importing the service doesn't bootstrap drizzle.
vi.mock('../../../shared/database/connection.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(async (fn: any) => fn({})),
  },
}));

// Mock alertService so the budget-alert path doesn't try to hit DB.
vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

// Mock cost-tracker side effects (budget gate + usage log) — pure no-ops here.
vi.mock('../cost-tracker.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    assertBudgetAvailable: vi.fn().mockResolvedValue(undefined),
    logUsage: vi.fn().mockResolvedValue(undefined),
    getMonthlySpendUSD: vi.fn().mockResolvedValue(0),
    getUsageSummary: vi.fn().mockResolvedValue({
      monthlySpendUSD: 0,
      budgetUSD: 200,
      budgetPctUsed: 0,
      byModel: [],
    }),
  };
});

const { aiService } = await import('../service.js');

describe('extractWithUpgrade behavior (invoice path)', () => {
  beforeEach(() => {
    delete process.env.AI_UPGRADE_ON_LOW_CONFIDENCE;
    delete process.env.AI_UPGRADE_CONFIDENCE_THRESHOLD;
    delete process.env.AI_UPGRADE_MIN_DELTA;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns primary result when confidence is above threshold (no upgrade call)', async () => {
    // Stub the AIService's internal chat to return a high-confidence response.
    const spy = vi.spyOn(aiService as any, 'chat').mockResolvedValueOnce(
      JSON.stringify({
        invoiceNumber: { value: 'INV-001', confidence: 0.95 },
        exporterName: { value: 'X', confidence: 0.9 },
        importerName: { value: 'Y', confidence: 0.9 },
        currency: { value: 'USD', confidence: 0.9 },
        totalFobValue: { value: 100, confidence: 0.9 },
        items: [],
      }),
    );
    const result = await aiService.extractInvoiceData('fake text');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7);
  });

  it('retries with upgrade model when primary < threshold AND adopts when delta >= 0.05', async () => {
    process.env.AI_UPGRADE_ON_LOW_CONFIDENCE = '1';
    process.env.AI_UPGRADE_CONFIDENCE_THRESHOLD = '0.7';
    process.env.AI_UPGRADE_MIN_DELTA = '0.05';
    const spy = vi
      .spyOn(aiService as any, 'chat')
      .mockResolvedValueOnce(
        JSON.stringify({
          invoiceNumber: { value: 'INV', confidence: 0.5 },
          exporterName: { value: 'X', confidence: 0.5 },
          importerName: { value: 'Y', confidence: 0.5 },
          currency: { value: 'USD', confidence: 0.5 },
          totalFobValue: { value: 100, confidence: 0.5 },
          items: [],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          invoiceNumber: { value: 'INV', confidence: 0.85 },
          exporterName: { value: 'X', confidence: 0.85 },
          importerName: { value: 'Y', confidence: 0.85 },
          currency: { value: 'USD', confidence: 0.85 },
          totalFobValue: { value: 100, confidence: 0.85 },
          items: [],
        }),
      );
    const result = await aiService.extractInvoiceData('fake');
    expect(spy).toHaveBeenCalledTimes(2);
    // Adopted the upgrade result (delta = 0.35 >> 0.05).
    expect(result.confidenceScore).toBeCloseTo(0.85, 2);
    // Second call was with the upgrade model.
    expect(spy.mock.calls[1][0]).toBe('gemini-2.5-pro');
  });

  it('keeps primary when upgrade does not improve by minDelta', async () => {
    process.env.AI_UPGRADE_ON_LOW_CONFIDENCE = '1';
    process.env.AI_UPGRADE_CONFIDENCE_THRESHOLD = '0.7';
    process.env.AI_UPGRADE_MIN_DELTA = '0.05';
    const spy = vi
      .spyOn(aiService as any, 'chat')
      .mockResolvedValueOnce(
        JSON.stringify({
          invoiceNumber: { value: 'INV', confidence: 0.5 },
          exporterName: { value: 'X', confidence: 0.5 },
          importerName: { value: 'Y', confidence: 0.5 },
          currency: { value: 'USD', confidence: 0.5 },
          totalFobValue: { value: 100, confidence: 0.5 },
          items: [],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          invoiceNumber: { value: 'INV', confidence: 0.52 },
          exporterName: { value: 'X', confidence: 0.52 },
          importerName: { value: 'Y', confidence: 0.52 },
          currency: { value: 'USD', confidence: 0.52 },
          totalFobValue: { value: 100, confidence: 0.52 },
          items: [],
        }),
      );
    const result = await aiService.extractInvoiceData('fake');
    expect(spy).toHaveBeenCalledTimes(2);
    // Stayed with primary (0.50) because upgrade (0.52) did not beat by 0.05.
    expect(result.confidenceScore).toBeCloseTo(0.5, 2);
  });

  it('falls back to primary when upgrade call throws', async () => {
    process.env.AI_UPGRADE_ON_LOW_CONFIDENCE = '1';
    process.env.AI_UPGRADE_CONFIDENCE_THRESHOLD = '0.7';
    const spy = vi
      .spyOn(aiService as any, 'chat')
      .mockResolvedValueOnce(
        JSON.stringify({
          invoiceNumber: { value: 'INV', confidence: 0.5 },
          exporterName: { value: 'X', confidence: 0.5 },
          importerName: { value: 'Y', confidence: 0.5 },
          currency: { value: 'USD', confidence: 0.5 },
          totalFobValue: { value: 100, confidence: 0.5 },
          items: [],
        }),
      )
      .mockRejectedValueOnce(new Error('upgrade timed out'));
    const result = await aiService.extractInvoiceData('fake');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.confidenceScore).toBeCloseTo(0.5, 2);
  });

  it('disabling AI_UPGRADE_ON_LOW_CONFIDENCE skips upgrade entirely', async () => {
    process.env.AI_UPGRADE_ON_LOW_CONFIDENCE = '0';
    const spy = vi.spyOn(aiService as any, 'chat').mockResolvedValueOnce(
      JSON.stringify({
        invoiceNumber: { value: 'INV', confidence: 0.4 },
        exporterName: { value: 'X', confidence: 0.4 },
        importerName: { value: 'Y', confidence: 0.4 },
        currency: { value: 'USD', confidence: 0.4 },
        totalFobValue: { value: 100, confidence: 0.4 },
        items: [],
      }),
    );
    const result = await aiService.extractInvoiceData('fake');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.confidenceScore).toBeCloseTo(0.4, 2);
  });
});
