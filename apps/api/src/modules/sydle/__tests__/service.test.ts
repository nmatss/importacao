import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();
mockDb.execute = vi.fn();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));

const { sydleService } = await import('../service.js');

describe('sydleService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    process.env = { ...originalEnv, SYDLE_SYNC_ENABLED: 'false' };
  });

  it('records skipped sync when SYDLE is not configured', async () => {
    const started = { id: 10, status: 'running', trigger: 'cron' };
    const completed = {
      id: 10,
      status: 'skipped',
      fetched: 0,
      created: 0,
      updated: 0,
      matched: 0,
      unmatched: 0,
      errors: 0,
    };

    queryQueue.push(createResolvedChain([started]));
    queryQueue.push(createResolvedChain([completed]));

    const result = await sydleService.sync('cron', null);

    expect(result).toEqual(completed);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('matches a payment by exact process code', async () => {
    queryQueue.push(
      createResolvedChain([
        {
          id: 264,
          processCode: 'IM0712602NB',
          purchaseRef: null,
          brand: 'puket',
          exporterName: 'KIOM GLOBAL LIMITED',
          totalFobValue: '24312.52',
          aiExtractedData: null,
        },
      ]),
    );

    const result = await sydleService.matchProcess({
      externalId: 'PAY-1',
      processCode: 'IM0712602NB',
      purchaseRef: null,
      purchaseOrder: null,
      proformaNumber: null,
      invoiceNumber: null,
      supplierName: null,
      brand: null,
      currency: 'USD',
      purchaseAmount: 24312.52,
      paidAmount: null,
      openAmount: null,
      paymentType: 'balance',
      paymentStatus: 'open',
      dueDate: null,
      paidAt: null,
      scheduledAt: null,
      exchangeRate: null,
      amountBrl: null,
      bankName: null,
      contractNumber: null,
      remittanceId: null,
      sourceUpdatedAt: null,
      rawPayload: {},
    });

    expect(result).toEqual({
      processId: 264,
      matchStatus: 'matched',
      matchScore: 1,
      matchReason: 'process_code',
    });
  });
});
