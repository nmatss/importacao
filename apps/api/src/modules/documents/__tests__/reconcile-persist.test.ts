import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../ai/service.js', () => ({
  flattenAiData: vi.fn((data) => data),
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: {
    create: vi.fn().mockResolvedValue({}),
    hasActiveAlert: vi.fn().mockResolvedValue(false),
  },
}));

const { reconcileProcessConfidence } = await import('../reconcile.js');

const cf = (value: unknown, confidence: number) => ({ value, confidence });

function invoicePayload() {
  return {
    invoiceNumber: cf('INV-1', 0.9),
    currency: cf('USD', 0.86),
    incoterm: cf('FOB', 0.82),
    totalFobValue: cf(200, 0.7),
    items: [
      {
        itemCode: cf('A1', 0.8),
        description: cf('CAMISETA', 0.7),
        quantity: cf(10, 0.7),
        unitPrice: cf(20, 0.7),
        totalPrice: cf(200, 0.6),
        isFreeOfCharge: cf(false, 0.8),
      },
    ],
  };
}

describe('reconcileProcessConfidence — lineage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  // A reconciliação sobrescrevia documents.aiParsedData sem arquivar. Como ela
  // roda a cada extração de documento irmão, o payload original da extração era
  // destruído em ROTINA e não era recuperável.
  it('arquiva a extracao anterior ANTES de sobrescrever aiParsedData', async () => {
    const original = invoicePayload();
    const doc = {
      id: 77,
      type: 'invoice',
      isProcessed: true,
      aiParsedData: original,
      confidenceScore: '0.72',
      originalFilename: 'invoice.pdf',
      storagePath: '/tmp/invoice.pdf',
    };

    const selectChain = createResolvedChain([doc]);
    const historyChain = createResolvedChain(undefined);
    const docUpdateChain = createResolvedChain(undefined);
    const processUpdateChain = createResolvedChain(undefined);
    const runsChain = createResolvedChain([{ id: 1 }]);
    const fieldsChain = createResolvedChain(undefined);
    queryQueue.push(
      selectChain,
      historyChain,
      docUpdateChain,
      processUpdateChain,
      runsChain,
      fieldsChain,
    );

    const results = await reconcileProcessConfidence(5);

    expect(results).toHaveLength(1);

    const archived = historyChain.values.mock.calls[0][0];
    expect(archived).toMatchObject({
      documentId: 77,
      processId: 5,
      documentType: 'invoice',
      originalFilename: 'invoice.pdf',
      storagePath: '/tmp/invoice.pdf',
      confidence: '0.72',
      reason: 'reconcile',
    });
    // O payload arquivado é o ORIGINAL, não o recalibrado.
    expect(archived.aiParsedData).toBe(original);

    // ...e o arquivamento acontece antes do update destrutivo.
    expect(mockDb.insert.mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.update.mock.invocationCallOrder[0],
    );
  });
});
