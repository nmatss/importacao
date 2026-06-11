import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

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
      const processSpy = vi
        .spyOn(documentService, 'processWithAI')
        .mockResolvedValue(undefined as never);
      vi.spyOn(documentService, 'getById').mockResolvedValue(mockDoc as never);

      queryQueue.push(createResolvedChain([mockDoc])); // select document
      const historyInsertChain = createResolvedChain(undefined); // insert history
      queryQueue.push(historyInsertChain);
      queryQueue.push(createResolvedChain(undefined)); // update doc (zero aiParsedData)

      await documentService.reprocess(7, 1);

      // Snapshot was written with the PREVIOUS data, confidence and reason
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(historyInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 7,
          aiParsedData: previousExtraction,
          confidence: '0.9000',
          reason: 'reprocess',
        }),
      );

      // ...BEFORE the update that zeroes the live column
      const insertOrder = mockDb.insert.mock.invocationCallOrder[0];
      const updateOrder = mockDb.update.mock.invocationCallOrder[0];
      expect(insertOrder).toBeLessThan(updateOrder);

      // Re-extraction is still triggered
      expect(processSpy).toHaveBeenCalledWith(7, 'invoice');
    });

    it('does not archive anything when the document was never extracted', async () => {
      vi.spyOn(documentService, 'processWithAI').mockResolvedValue(undefined as never);
      vi.spyOn(documentService, 'getById').mockResolvedValue(mockDoc as never);

      const emptyDoc = { ...mockDoc, aiParsedData: null, confidenceScore: null };
      queryQueue.push(createResolvedChain([emptyDoc])); // select document
      queryQueue.push(createResolvedChain(undefined)); // update doc

      await documentService.reprocess(7, 1);

      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
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
  });
});
