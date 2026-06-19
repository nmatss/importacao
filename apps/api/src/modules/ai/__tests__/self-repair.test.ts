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

const { aiService } = await import('../service.js');

function cf<T>(value: T | null, confidence: number) {
  return { value, confidence };
}

// Source long enough (>= 50 non-space chars) for the self-repair grounding gate.
const SOURCE = `COMMERCIAL INVOICE issued by KIOM GLOBAL LIMITED in NINGBO CHINA for UNI.CO with several line items and totals printed below in the body of the document`;

function lowExporterInvoice(confidence: number) {
  return JSON.stringify({
    invoiceNumber: cf('INV-001', confidence),
    invoiceDate: cf('2026-06-01', confidence),
    // exporterName comes back empty → a groundable header field to repair.
    exporterName: cf(null, 0),
    exporterAddress: cf('addr', confidence),
    importerName: cf('Y', confidence),
    importerAddress: cf('addr', confidence),
    incoterm: cf('FOB', confidence),
    currency: cf('USD', confidence),
    portOfLoading: cf('NINGBO', confidence),
    portOfDischarge: cf('ITAPOA', confidence),
    totalFobValue: cf(100, confidence),
    items: [
      {
        itemCode: cf('A1', confidence),
        description: cf('Item A1', confidence),
        quantity: cf(10, confidence),
        unitPrice: cf(10, confidence),
        totalPrice: cf(100, confidence),
      },
    ],
  });
}

describe('self-repair loop (invoice path)', () => {
  beforeEach(() => {
    delete process.env.AI_SELF_REPAIR;
    delete process.env.AI_SELF_REPAIR_THRESHOLD;
    // Keep the upgrade pass out of the way so we count only primary + repair.
    process.env.AI_UPGRADE_ON_LOW_CONFIDENCE = '0';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AI_UPGRADE_ON_LOW_CONFIDENCE;
  });

  it('runs a second targeted call and merges higher-confidence fields', async () => {
    const spy = vi
      .spyOn(aiService as any, 'chat')
      // primary extraction: exporterName empty
      .mockResolvedValueOnce(lowExporterInvoice(0.9))
      // self-repair: returns the missing exporterName with high confidence
      .mockResolvedValueOnce(
        JSON.stringify({ exporterName: cf('KIOM GLOBAL LIMITED', 0.88) }),
      );

    const result = await aiService.extractInvoiceData(SOURCE);

    expect(spy).toHaveBeenCalledTimes(2);
    // Second call is the targeted self-repair context.
    expect(spy.mock.calls[1][3]).toBe('invoice_self_repair');
    expect(result.data.exporterName.value).toBe('KIOM GLOBAL LIMITED');
    expect(result.data.exporterName.confidence).toBeCloseTo(0.88, 2);
  });

  it('does NOT lower a field when the repair returns lower confidence', async () => {
    const spy = vi
      .spyOn(aiService as any, 'chat')
      .mockResolvedValueOnce(
        // exporterName present but below threshold (0.3)
        JSON.stringify({
          invoiceNumber: cf('INV-001', 0.9),
          exporterName: cf('KIOM GLOBAL LIMITED', 0.3),
          currency: cf('USD', 0.9),
          totalFobValue: cf(100, 0.9),
          items: [
            {
              itemCode: cf('A1', 0.9),
              quantity: cf(10, 0.9),
              unitPrice: cf(10, 0.9),
              totalPrice: cf(100, 0.9),
            },
          ],
        }),
      )
      // repair returns a worse confidence — must be ignored
      .mockResolvedValueOnce(JSON.stringify({ exporterName: cf('KIOM GLOBAL LIMITED', 0.2) }));

    const result = await aiService.extractInvoiceData(SOURCE);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.data.exporterName.confidence).toBeCloseTo(0.3, 2);
  });

  it('is skipped entirely when disabled via AI_SELF_REPAIR=0', async () => {
    process.env.AI_SELF_REPAIR = '0';
    const spy = vi.spyOn(aiService as any, 'chat').mockResolvedValueOnce(lowExporterInvoice(0.9));

    const result = await aiService.extractInvoiceData(SOURCE);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.data.exporterName.value).toBeNull();
  });

  it('is skipped cleanly when the provider is unavailable', async () => {
    const original = (aiService as any).provider;
    // Simulate an offline/local-unavailable provider (no callModel).
    (aiService as any).provider = { name: 'ialocal', normalizeModel: (m: string) => m };
    try {
      const spy = vi.spyOn(aiService as any, 'chat').mockResolvedValueOnce(lowExporterInvoice(0.9));
      const result = await aiService.extractInvoiceData(SOURCE);
      // Only the primary extraction call happened; repair was skipped.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result.data.exporterName.value).toBeNull();
    } finally {
      (aiService as any).provider = original;
    }
  });
});
