import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  flattenAiData: vi.fn((data) => data),
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

const mockFsUnlink = vi.fn().mockResolvedValue(undefined);
const mockFsReadFile = vi.fn().mockResolvedValue(Buffer.from('mock content'));

vi.mock('fs/promises', () => ({
  default: {
    readFile: mockFsReadFile,
    unlink: mockFsUnlink,
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
const { auditService } = await import('../../audit/service.js');

describe('documentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });

  describe('upload()', () => {
    it('should reject upload and remove temp file when process is locked', async () => {
      const mockFile = {
        originalname: 'invoice.pdf',
        path: '/tmp/invoice.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      } as Express.Multer.File;

      queryQueue.push(
        createResolvedChain([
          { lockedAt: new Date('2026-05-22T00:00:00Z'), lockedReason: 'vimbar_approval' },
        ]),
      );

      await expect(documentService.upload(1, 'invoice', mockFile, 1)).rejects.toMatchObject({
        statusCode: 423,
      });

      expect(mockFsUnlink).toHaveBeenCalledWith('/tmp/invoice.pdf');
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should insert document and trigger AI processing', async () => {
      const mockDoc = { id: 1, processId: 1, type: 'invoice' };
      const mockFile = {
        originalname: 'invoice.pdf',
        path: '/tmp/invoice.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      } as Express.Multer.File;

      queryQueue.push(createResolvedChain([])); // assert process not locked
      // insert document returning
      queryQueue.push(createResolvedChain([mockDoc]));
      // select docs to check all 3 present -> only 1 doc
      queryQueue.push(createResolvedChain([{ type: 'invoice' }]));

      const result = await documentService.upload(1, 'invoice', mockFile, 1);

      expect(result).toMatchObject({
        id: 1,
        processId: 1,
        documentType: 'invoice',
        aiProcessingStatus: 'processing',
      });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        1,
        'upload',
        'document',
        1,
        expect.objectContaining({ processId: 1, type: 'invoice' }),
        null,
      );
    });

    it('should update status to documents_received when all 3 docs present', async () => {
      const mockDoc = { id: 3, processId: 1, type: 'ohbl' };
      const mockFile = {
        originalname: 'bl.pdf',
        path: '/tmp/bl.pdf',
        mimetype: 'application/pdf',
        size: 2048,
      } as Express.Multer.File;

      const allDocs = [{ type: 'invoice' }, { type: 'packing_list' }, { type: 'ohbl' }];

      queryQueue.push(createResolvedChain([])); // assert process not locked
      // insert doc
      queryQueue.push(createResolvedChain([mockDoc]));
      // select all docs for process
      queryQueue.push(createResolvedChain(allDocs));
      // select current process status
      queryQueue.push(createResolvedChain([{ status: 'draft' }]));
      // update process status
      queryQueue.push(createResolvedChain(undefined));
      // update followUpTracking
      queryQueue.push(createResolvedChain(undefined));
      // select processCode for alert
      queryQueue.push(createResolvedChain([{ processCode: 'IMP-001' }]));

      const result = await documentService.upload(1, 'ohbl', mockFile, 1);

      expect(result).toMatchObject({
        id: 3,
        processId: 1,
        documentType: 'ohbl',
        aiProcessingStatus: 'processing',
      });
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('getByProcess()', () => {
    it('should return all documents for a process', async () => {
      const mockDocs = [
        { id: 1, processId: 1, type: 'invoice' },
        { id: 2, processId: 1, type: 'packing_list' },
      ];

      queryQueue.push(createResolvedChain(mockDocs));

      const result = await documentService.getByProcess(1);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('fileName');
      expect(result[0]).toHaveProperty('documentType');
      expect(result[0]).toHaveProperty('aiProcessingStatus');
    });
  });

  describe('delete()', () => {
    it('should remove file, DB record and rebuild process AI projection', async () => {
      const mockDoc = {
        id: 1,
        processId: 1,
        type: 'invoice',
        storagePath: '/tmp/test.pdf',
        originalFilename: 'test.pdf',
      };

      // select doc
      queryQueue.push(createResolvedChain([mockDoc]));
      queryQueue.push(createResolvedChain([])); // assert process not locked
      txQueue.push(createResolvedChain(undefined)); // delete doc
      txQueue.push(createResolvedChain([])); // remaining docs for rebuild
      txQueue.push(
        createResolvedChain([
          {
            aiExtractedData: {
              invoice: { invoiceNumber: 'stale' },
              customKey: { keep: true },
            },
          },
        ]),
      );
      const processUpdateChain = createResolvedChain(undefined);
      txQueue.push(processUpdateChain);

      const result = await documentService.delete(1, 2);

      expect(result).toEqual({ id: 1 });
      expect(mockFsUnlink).toHaveBeenCalledWith('/tmp/test.pdf');
      expect(mockTx.delete).toHaveBeenCalled();
      expect(processUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          aiExtractedData: { customKey: { keep: true } },
          updatedAt: expect.any(Date),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        2,
        'delete',
        'document',
        1,
        expect.objectContaining({ processId: 1 }),
        null,
      );
    });
  });

  describe('rebuildProcessAiExtractedData()', () => {
    it('rebuilds projected document data from current processed documents only', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 4,
            type: 'invoice',
            isProcessed: true,
            aiParsedData: { invoiceNumber: 'INV-NEW' },
          },
          {
            id: 3,
            type: 'invoice',
            isProcessed: true,
            aiParsedData: { invoiceNumber: 'INV-OLD' },
          },
          {
            id: 5,
            type: 'packing_list',
            isProcessed: false,
            aiParsedData: { packingListNumber: 'PL-PENDING' },
          },
          {
            id: 6,
            type: 'ohbl',
            isProcessed: true,
            aiParsedData: { extractionFailed: true, reason: 'AI failed' },
          },
          {
            id: 7,
            type: 'espelho',
            isProcessed: true,
            confidenceScore: '0.99',
            aiParsedData: { summary: { processCode: 'IMP-1' }, items: [{ itemCode: 'A1' }] },
          },
        ]),
      );
      queryQueue.push(
        createResolvedChain([
          {
            aiExtractedData: {
              invoice: { invoiceNumber: 'STALE' },
              packing_list: { packingListNumber: 'STALE' },
              customKey: { keep: true },
            },
          },
        ]),
      );
      const processUpdateChain = createResolvedChain(undefined);
      queryQueue.push(processUpdateChain);

      const rebuilt = await documentService.rebuildProcessAiExtractedData(1);

      expect(rebuilt).toEqual({
        customKey: { keep: true },
        invoice: { invoiceNumber: 'INV-NEW' },
        espelho: { summary: { processCode: 'IMP-1' }, items: [{ itemCode: 'A1' }] },
      });
      expect(processUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          aiExtractedData: rebuilt,
          updatedAt: expect.any(Date),
        }),
      );
    });

    it('does not project very-low-confidence document data', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 8,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.39',
            aiParsedData: { invoiceNumber: 'LOW-CONFIDENCE' },
          },
          {
            id: 9,
            type: 'packing_list',
            isProcessed: true,
            confidenceScore: '0.40',
            aiParsedData: { packingListNumber: 'PL-VALID' },
          },
        ]),
      );
      queryQueue.push(createResolvedChain([{ aiExtractedData: { customKey: { keep: true } } }]));
      const processUpdateChain = createResolvedChain(undefined);
      queryQueue.push(processUpdateChain);

      const rebuilt = await documentService.rebuildProcessAiExtractedData(1);

      expect(rebuilt).toEqual({
        customKey: { keep: true },
        packing_list: { packingListNumber: 'PL-VALID' },
      });
      expect(processUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ aiExtractedData: rebuilt }),
      );
    });
  });

  describe('getComparison()', () => {
    it('does not compare invoice issue date as ETD and uses strict port normalization', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 1,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.90',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            aiParsedData: {
              invoiceDate: '2026-01-01',
              portOfLoading: 'SANTOS',
              portOfDischarge: 'ITAPOA',
            },
          },
          {
            id: 2,
            type: 'packing_list',
            isProcessed: true,
            confidenceScore: '0.90',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            updatedAt: new Date('2026-01-02T00:00:00Z'),
            aiParsedData: {
              shipmentDate: '2026-02-01',
              portOfLoading: 'SANTOS DUMONT',
              portOfDischarge: 'ITAPOA, BRAZIL',
            },
          },
          {
            id: 3,
            type: 'ohbl',
            isProcessed: true,
            confidenceScore: '0.90',
            createdAt: new Date('2026-01-03T00:00:00Z'),
            updatedAt: new Date('2026-01-03T00:00:00Z'),
            aiParsedData: { shipmentDate: '2026-02-01', portOfDischarge: 'ITAPOA' },
          },
        ]),
      );
      queryQueue.push(createResolvedChain([{ id: 1, aiExtractedData: {} }]));

      const comparison = await documentService.getComparison(1);
      const etd = comparison.aggregateComparison.find(
        (row: any) => row.label === 'ETD / Shipped On Board',
      );
      const loadingPort = comparison.aggregateComparison.find(
        (row: any) => row.label === 'Porto Embarque',
      );
      const dischargePort = comparison.aggregateComparison.find(
        (row: any) => row.label === 'Porto Destino',
      );

      expect(etd).toMatchObject({
        invoice: null,
        packingList: '2026-02-01',
        bl: '2026-02-01',
        status: 'match',
      });
      expect(loadingPort).toMatchObject({ status: 'divergent' });
      expect(dischargePort).toMatchObject({ status: 'match' });
    });
  });

  describe('extractText()', () => {
    it('should handle PDF files', async () => {
      const result = await documentService.extractText('/tmp/test.pdf', 'application/pdf');

      expect(result.text).toBe('Extracted PDF text');
    });

    it('should handle Excel files', async () => {
      const result = await documentService.extractText(
        '/tmp/test.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      expect(result.text).toContain('col1,col2');
    });
  });
});
