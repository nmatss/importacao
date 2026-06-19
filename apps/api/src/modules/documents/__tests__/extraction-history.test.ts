import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, mockTx, queryQueue, txQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../ai/service.js', () => ({
  aiService: {
    extractInvoiceData: vi.fn().mockResolvedValue({ data: {}, confidenceScore: 0.9 }),
    extractPackingListData: vi.fn().mockResolvedValue({ data: {}, confidenceScore: 0.85 }),
    extractBLData: vi.fn().mockResolvedValue({ data: {}, confidenceScore: 0.88 }),
  },
  flattenAiData: vi.fn((d) => d),
}));

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    isConfigured: vi.fn().mockResolvedValue(false),
    isRootConfigured: vi.fn().mockResolvedValue(false),
    uploadToProcessFolder: vi.fn().mockResolvedValue('drive-file-id'),
  },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/state-machine/process-states.js', () => ({
  assertTransition: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('mock content')),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({ text: 'Extracted PDF text' }),
}));

vi.mock('xlsx', () => ({
  read: vi.fn().mockReturnValue({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: {} },
  }),
  utils: {
    sheet_to_csv: vi.fn().mockReturnValue('col1,col2\nval1,val2'),
  },
}));

const { documentService } = await import('../service.js');

describe('document extraction history (backlog #12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('reprocess()', () => {
    const previousExtraction = { invoiceNumber: 'INV-001', totalValue: 1234.5 };
    const mockDoc = {
      id: 7,
      processId: 1,
      type: 'invoice',
      aiParsedData: previousExtraction,
      confidenceScore: '0.9000',
      isProcessed: true,
    };

    it('archives the previous extraction BEFORE zeroing aiParsedData', async () => {
      // Isolate reprocess from the downstream AI pipeline
      const enqueueSpy = vi
        .spyOn(documentService, 'enqueueAIExtraction')
        .mockResolvedValue(undefined as never);
      vi.spyOn(documentService, 'getById').mockResolvedValue(mockDoc as never);

      queryQueue.push(createResolvedChain([mockDoc])); // select document (outside tx)
      queryQueue.push(createResolvedChain([])); // assert process not locked
      const historyInsertChain = createResolvedChain(undefined); // insert history (in tx)
      txQueue.push(historyInsertChain);
      txQueue.push(createResolvedChain(undefined)); // update doc (zero aiParsedData) (in tx)
      txQueue.push(createResolvedChain([])); // rebuild process aiExtractedData: remaining docs
      txQueue.push(createResolvedChain([{ aiExtractedData: { invoice: previousExtraction } }])); // current process projection
      txQueue.push(createResolvedChain(undefined)); // update process projection

      await documentService.reprocess(7, 1);

      // Snapshot was written with the PREVIOUS data, confidence and reason
      // (archive + zero now run atomically inside db.transaction -> mockTx).
      expect(mockTx.insert).toHaveBeenCalledTimes(1);
      expect(historyInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 7,
          processId: 1,
          documentType: 'invoice',
          aiParsedData: previousExtraction,
          confidence: '0.9000',
          reason: 'reprocess',
        }),
      );

      // ...BEFORE the update that zeroes the live column
      const insertOrder = mockTx.insert.mock.invocationCallOrder[0];
      const updateOrder = mockTx.update.mock.invocationCallOrder[0];
      expect(insertOrder).toBeLessThan(updateOrder);

      // Re-extraction is still queued
      expect(enqueueSpy).toHaveBeenCalledWith(mockDoc, 'invoice');
    });

    it('does not archive anything when the document was never extracted', async () => {
      vi.spyOn(documentService, 'enqueueAIExtraction').mockResolvedValue(undefined as never);
      vi.spyOn(documentService, 'getById').mockResolvedValue(mockDoc as never);

      const emptyDoc = { ...mockDoc, aiParsedData: null, confidenceScore: null };
      queryQueue.push(createResolvedChain([emptyDoc])); // select document (outside tx)
      queryQueue.push(createResolvedChain([])); // assert process not locked
      txQueue.push(createResolvedChain(undefined)); // update doc (in tx)
      txQueue.push(createResolvedChain([])); // rebuild process aiExtractedData: remaining docs
      txQueue.push(createResolvedChain([{ aiExtractedData: { invoice: previousExtraction } }])); // current process projection
      txQueue.push(createResolvedChain(undefined)); // update process projection

      await documentService.reprocess(7, 1);

      // archive (insert) is skipped when there was no prior extraction; the
      // zeroing update still runs, both inside db.transaction -> mockTx.
      expect(mockTx.insert).not.toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalled();
    });

    it('rejects duplicate reprocess while extraction is already active', async () => {
      const freshProcessingDoc = {
        ...mockDoc,
        isProcessed: false,
        aiParsedData: null,
        confidenceScore: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      queryQueue.push(createResolvedChain([freshProcessingDoc]));
      queryQueue.push(createResolvedChain([])); // assert process not locked

      await expect(documentService.reprocess(7, 1)).rejects.toMatchObject({
        statusCode: 409,
      });

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe('archiveExtraction()', () => {
    it('archives with reason reextract', async () => {
      const historyInsertChain = createResolvedChain(undefined);
      queryQueue.push(historyInsertChain);

      await documentService.archiveExtraction(
        { id: 9, aiParsedData: { foo: 'bar' }, confidenceScore: '0.8000' },
        'reextract',
      );

      expect(historyInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 9,
          aiParsedData: { foo: 'bar' },
          confidence: '0.8000',
          reason: 'reextract',
        }),
      );
    });

    it('is a no-op when there is no previous extraction', async () => {
      await documentService.archiveExtraction(
        { id: 9, aiParsedData: null, confidenceScore: null },
        'reprocess',
      );
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('delete()', () => {
    it('archives the current extraction before deleting the document row', async () => {
      const previousExtraction = { invoiceNumber: 'INV-DELETE' };
      const doc = {
        id: 10,
        processId: 1,
        type: 'invoice',
        originalFilename: 'invoice-delete.pdf',
        storagePath: '/tmp/invoice-delete.pdf',
        aiParsedData: previousExtraction,
        confidenceScore: '0.8500',
      };

      queryQueue.push(createResolvedChain([doc])); // select document
      queryQueue.push(createResolvedChain([])); // assert process not locked
      const historyInsertChain = createResolvedChain(undefined);
      txQueue.push(historyInsertChain); // archive history
      txQueue.push(createResolvedChain(undefined)); // delete document
      txQueue.push(createResolvedChain([])); // rebuild: remaining docs
      txQueue.push(createResolvedChain([{ aiExtractedData: { invoice: previousExtraction } }])); // process
      txQueue.push(createResolvedChain(undefined)); // update process projection

      await documentService.delete(10, 1);

      expect(historyInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 10,
          processId: 1,
          documentType: 'invoice',
          originalFilename: 'invoice-delete.pdf',
          storagePath: '/tmp/invoice-delete.pdf',
          aiParsedData: previousExtraction,
          confidence: '0.8500',
          reason: 'delete',
        }),
      );

      const insertOrder = mockTx.insert.mock.invocationCallOrder[0];
      const deleteOrder = mockTx.delete.mock.invocationCallOrder[0];
      expect(insertOrder).toBeLessThan(deleteOrder);
    });
  });

  describe('getExtractionHistory()', () => {
    it('returns archived extractions for a document', async () => {
      const rows = [
        { id: 2, documentId: 7, reason: 'reprocess', aiParsedData: { v: 2 } },
        { id: 1, documentId: 7, reason: 'reextract', aiParsedData: { v: 1 } },
      ];
      queryQueue.push(createResolvedChain(rows));

      const history = await documentService.getExtractionHistory(7);

      expect(history).toEqual(rows);
    });

    it('returns archived extractions for a process including deleted documents', async () => {
      const rows = [
        {
          id: 3,
          documentId: null,
          processId: 1,
          documentType: 'invoice',
          reason: 'delete',
          aiParsedData: { invoiceNumber: 'INV-DELETE' },
        },
      ];
      queryQueue.push(createResolvedChain(rows));

      const history = await documentService.getExtractionHistoryByProcess(1);

      expect(history).toEqual(rows);
    });
  });
});
