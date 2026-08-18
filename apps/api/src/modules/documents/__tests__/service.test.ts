import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, mockTx, queryQueue, txQueue } = createMockDb();
const mockQueueSend = vi.fn();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/queue/index.js', () => ({
  getQueue: vi.fn().mockResolvedValue({ send: mockQueueSend }),
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
    // Default to the Vertex-like capability so the pre-existing cases keep
    // exercising the raw-PDF path; the rasterization cases flip it explicitly.
    acceptsPdfInput: true,
    providerName: 'vertex',
  },
  flattenAiData: vi.fn((data) => data),
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

vi.mock('../ocr.js', () => ({
  ocrScannedPdf: vi.fn().mockResolvedValue(null),
  rasterizePdfPages: vi.fn().mockResolvedValue(null),
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
const { ocrScannedPdf, rasterizePdfPages } = await import('../ocr.js');
const { aiService } = await import('../../ai/service.js');

describe('documentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueSend.mockResolvedValue('job-1');
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
      // checagem de duplicata — sem duplicata
      queryQueue.push(createResolvedChain([]));
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
      // checagem de duplicata (mesmo nome + tamanho no processo) — sem duplicata
      queryQueue.push(createResolvedChain([]));
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

    it('avisa quando o mesmo arquivo ja existe no processo, sem bloquear o upload', async () => {
      // 14 grupos de duplicata em 133 documentos na base de 17/08. Duplicata
      // dobra o custo de reprocessamento e confunde a conferencia — mas
      // recusar o upload atrapalharia mais, porque reenviar a mesma invoice
      // corrigida com o mesmo nome e pratica legitima do time.
      const { alertService } = await import('../../alerts/service.js');
      const mockDoc = { id: 9, processId: 1, type: 'invoice' };
      const mockFile = {
        originalname: 'KIOM INV - PK2052602TJ.pdf',
        path: '/tmp/inv.pdf',
        mimetype: 'application/pdf',
        size: 223881,
      } as Express.Multer.File;

      queryQueue.push(createResolvedChain([])); // processo nao travado
      queryQueue.push(createResolvedChain([mockDoc])); // insert
      queryQueue.push(createResolvedChain([{ id: 5 }])); // JA EXISTE outro igual
      queryQueue.push(createResolvedChain([{ processCode: 'PK2052602TJ' }])); // processCode p/ alerta
      queryQueue.push(createResolvedChain([{ type: 'invoice' }])); // docs do processo

      const result = await documentService.upload(1, 'invoice', mockFile, 1);

      expect(result).toMatchObject({ id: 9 });
      expect(alertService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Documento duplicado no processo',
          severity: 'warning',
        }),
      );
    });

    it('should treat Draft BL as BL for documents_received milestone', async () => {
      const mockDoc = { id: 4, processId: 1, type: 'draft_bl' };
      const mockFile = {
        originalname: 'draft-bl.pdf',
        path: '/tmp/draft-bl.pdf',
        mimetype: 'application/pdf',
        size: 2048,
      } as Express.Multer.File;

      const allDocs = [{ type: 'invoice' }, { type: 'packing_list' }, { type: 'draft_bl' }];

      queryQueue.push(createResolvedChain([])); // assert process not locked
      queryQueue.push(createResolvedChain([mockDoc])); // insert doc
      queryQueue.push(createResolvedChain([])); // checagem de duplicata — sem duplicata
      queryQueue.push(createResolvedChain(allDocs)); // select all docs for process
      queryQueue.push(createResolvedChain([{ status: 'draft' }])); // select current process status
      queryQueue.push(createResolvedChain(undefined)); // update process status
      queryQueue.push(createResolvedChain(undefined)); // update followUpTracking
      queryQueue.push(createResolvedChain([{ processCode: 'IMP-001' }])); // select processCode

      await documentService.upload(1, 'draft_bl', mockFile, 1);

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

    it('marks processed documents without meaningful extracted data as failed', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 1,
            processId: 1,
            type: 'invoice',
            originalFilename: 'invoice.pdf',
            isProcessed: true,
            aiParsedData: {
              invoiceNumber: { value: null, confidence: 0 },
              exporterName: { value: '', confidence: 0 },
              items: [],
            },
          },
          {
            id: 2,
            processId: 1,
            type: 'packing_list',
            originalFilename: 'pl.pdf',
            isProcessed: true,
            aiParsedData: {
              exporterName: { value: 'KIOM GLOBAL LIMITED', confidence: 1 },
            },
          },
        ]),
      );

      const result = await documentService.getByProcess(1);

      expect(result[0]).toMatchObject({ documentType: 'invoice', aiProcessingStatus: 'failed' });
      expect(result[1]).toMatchObject({
        documentType: 'packing_list',
        aiProcessingStatus: 'completed',
      });
    });

    it('marks processed documents with only an AI error reason as failed', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 3,
            processId: 1,
            type: 'invoice',
            originalFilename: 'invoice-fetch-failed.pdf',
            isProcessed: true,
            aiParsedData: { reason: 'fetch failed' },
          },
        ]),
      );

      const result = await documentService.getByProcess(1);

      expect(result[0]).toMatchObject({ documentType: 'invoice', aiProcessingStatus: 'failed' });
    });
  });

  describe('enqueueAIExtraction()', () => {
    it('falls back to in-process extraction when queue returns no job id', async () => {
      mockQueueSend.mockResolvedValueOnce(null);
      const processSpy = vi
        .spyOn(documentService, 'processWithAI')
        .mockResolvedValue(undefined as never);

      try {
        await documentService.enqueueAIExtraction(
          {
            id: 99,
            processId: 1,
            type: 'invoice',
            storagePath: '/tmp/invoice.pdf',
            originalFilename: 'invoice.pdf',
          },
          'invoice',
        );

        expect(mockQueueSend).toHaveBeenCalledWith(
          'ai-extraction',
          expect.objectContaining({ documentId: 99, documentType: 'invoice' }),
          // Retry obrigatório (auditoria 2026-07-17): sem retryLimit um crash
          // do worker deixava o documento preso para sempre.
          expect.objectContaining({ retryLimit: 2, retryBackoff: true }),
        );
        expect(processSpy).toHaveBeenCalledWith(99, 'invoice');
      } finally {
        processSpy.mockRestore();
      }
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
      expect(mockTx.delete.mock.invocationCallOrder[0]).toBeLessThan(
        mockFsUnlink.mock.invocationCallOrder[0],
      );
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

  describe('reclassify()', () => {
    it('archives the prior extraction, rebuilds projections and queues the corrected parser', async () => {
      const mockDoc = {
        id: 21,
        processId: 1,
        type: 'other',
        storagePath: '/tmp/misclassified.pdf',
        originalFilename: 'documento.pdf',
        isProcessed: true,
        confidenceScore: '0.8',
        aiParsedData: { invoiceNumber: { value: 'INV-21', confidence: 0.8 } },
      };
      const enqueueSpy = vi.spyOn(documentService, 'enqueueAIExtraction').mockResolvedValue();

      // Current document + lock check.
      queryQueue.push(createResolvedChain([mockDoc]));
      queryQueue.push(createResolvedChain([]));
      // Transaction: archive, reset/type update, rebuild current projection.
      txQueue.push(createResolvedChain(undefined));
      txQueue.push(createResolvedChain(undefined));
      txQueue.push(createResolvedChain([]));
      txQueue.push(createResolvedChain([{ aiExtractedData: { custom: true } }]));
      txQueue.push(createResolvedChain(undefined));
      // Invalidate comparison acceptances after the transaction.
      queryQueue.push(createResolvedChain(undefined));

      try {
        const result = await documentService.reclassify(21, 'invoice', 7);

        expect(result).toMatchObject({
          id: 21,
          documentType: 'invoice',
          aiProcessingStatus: 'processing',
        });
        expect(mockTx.insert).toHaveBeenCalled();
        expect(mockTx.update).toHaveBeenCalled();
        expect(enqueueSpy).toHaveBeenCalledWith(
          expect.objectContaining({ id: 21, type: 'invoice' }),
          'invoice',
        );
        expect(auditService.log).toHaveBeenCalledWith(
          7,
          'reclassify',
          'document',
          21,
          expect.objectContaining({ fromType: 'other', toType: 'invoice' }),
          null,
        );
      } finally {
        enqueueSpy.mockRestore();
      }
    });
  });

  describe('getSource()', () => {
    it('uses relational attachment lineage before the legacy filename scan', async () => {
      queryQueue.push(createResolvedChain([{ id: 31, processId: 1, originalFilename: 'INV.pdf' }]));
      queryQueue.push(createResolvedChain([{ emailSubject: 'Invoice do fornecedor' }]));

      await expect(documentService.getSource(31)).resolves.toEqual({
        source: 'email',
        emailSubject: 'Invoice do fornecedor',
      });
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  describe('rebuildProcessAiExtractedData()', () => {
    it('rebuilds projected document data from current processed documents only', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 5,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.99',
            aiParsedData: {
              invoiceNumber: { value: null, confidence: 0 },
              exporterName: { value: '', confidence: 0 },
              items: [],
            },
          },
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
    it('uses invoice issue date as a wide-tolerance ETD fallback and strict port normalization', async () => {
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

      // Invoice has no ETD/shipmentDate, so its issue date (2026-01-01) is used as
      // a fallback. The ~31-day gap to the BL shipment date (2026-02-01) is within
      // the widened tolerance (matchDays 45) and must NOT flag as divergent —
      // per Eduarda, these dates do not need to be equal.
      expect(etd).toMatchObject({
        invoice: '2026-01-01',
        packingList: '2026-02-01',
        bl: '2026-02-01',
        status: 'match',
      });
      expect(loadingPort).toMatchObject({ status: 'divergent' });
      expect(dischargePort).toMatchObject({ status: 'match' });
    });

    it('does not treat processed documents without meaningful extraction as available', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 1,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.99',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            aiParsedData: {
              invoiceNumber: { value: null, confidence: 0 },
              exporterName: { value: '', confidence: 0 },
              items: [],
            },
          },
          {
            id: 2,
            type: 'packing_list',
            isProcessed: true,
            confidenceScore: '0.90',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            updatedAt: new Date('2026-01-02T00:00:00Z'),
            aiParsedData: { exporterName: 'KIOM GLOBAL LIMITED', items: [{ itemCode: 'A1' }] },
          },
        ]),
      );
      queryQueue.push(createResolvedChain([{ id: 1, aiExtractedData: {} }]));

      const comparison = await documentService.getComparison(1);

      expect(comparison.hasInvoice).toBe(false);
      expect(comparison.hasPackingList).toBe(true);
      expect(comparison.itemComparison).toHaveLength(0);
      expect(
        comparison.aggregateComparison.find((row: any) => row.label === 'Exportador / Shipper'),
      ).toMatchObject({ invoice: null, packingList: 'KIOM GLOBAL LIMITED' });
    });

    it('uses Draft BL as the operational BL in comparison when final BL is absent', async () => {
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
              exporterName: 'KIOM GLOBAL LIMITED',
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
              exporterName: 'KIOM GLOBAL LIMITED',
              portOfDischarge: 'ITAPOA, BRAZIL',
            },
          },
          {
            id: 3,
            type: 'draft_bl',
            isProcessed: true,
            confidenceScore: '0.88',
            createdAt: new Date('2026-01-03T00:00:00Z'),
            updatedAt: new Date('2026-01-03T00:00:00Z'),
            aiParsedData: {
              shipper: 'KIOM GLOBAL LIMITED',
              portOfDischarge: 'ITAPOA',
              blNumber: 'DRAFT-001',
            },
          },
        ]),
      );
      queryQueue.push(createResolvedChain([{ id: 1, aiExtractedData: {} }]));

      const comparison = await documentService.getComparison(1);
      const dischargePort = comparison.aggregateComparison.find(
        (row: any) => row.label === 'Porto Destino',
      );
      const blNumber = comparison.aggregateComparison.find(
        (row: any) => row.label === 'BL Number (shipping)',
      );

      expect(comparison).toMatchObject({
        hasBl: true,
        hasFinalBl: false,
        hasOperationalBl: true,
        operationalBlSource: 'draft_bl',
        blConfidence: '0.88',
        draftBlConfidence: '0.88',
      });
      expect(dischargePort).toMatchObject({ bl: 'ITAPOA', status: 'match' });
      expect(blNumber).toMatchObject({ bl: 'DRAFT-001' });
    });

    it('exposes separate net + gross weights per item (peso liquido x peso bruto)', async () => {
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
              exporterName: 'KIOM GLOBAL LIMITED',
              items: [
                {
                  itemCode: 'PI7752Y',
                  description: 'Blouse',
                  quantity: 100,
                  unitPrice: 5.5,
                  totalPrice: 550,
                  netWeight: 28,
                  grossWeight: 31,
                },
              ],
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
              exporterName: 'KIOM GLOBAL LIMITED',
              items: [
                {
                  itemCode: 'PI7752Y',
                  quantity: 100,
                  boxQuantity: 50,
                  netWeight: 30,
                  grossWeight: 35,
                },
              ],
            },
          },
        ]),
      );
      queryQueue.push(
        createResolvedChain([
          {
            id: 1,
            aiExtractedData: {
              espelho: {
                summary: {},
                items: [
                  {
                    codigo: 'PI7752Y',
                    qty: 100,
                    pesoLiquidoTotal: 29,
                    pesoBrutoTotal: 33,
                  },
                ],
              },
            },
          },
        ]),
      );

      const comparison = await documentService.getComparison(1);
      expect(comparison.itemComparison).toHaveLength(1);
      const row = comparison.itemComparison[0] as Record<string, any>;
      // Net (peso liquido) per source
      expect(row.invoiceNetWeight).toBe(28);
      expect(row.plNetWeight).toBe(30);
      expect(row.espelhoNetWeight).toBe(29);
      // Gross (peso bruto) per source
      expect(row.invoiceGrossWeight).toBe(31);
      expect(row.plGrossWeight).toBe(35);
      expect(row.espelhoGrossWeight).toBe(33);
      // Legacy aggregate weight kept for backward compatibility
      expect(row.plWeight).toBe(35);
    });

    it('exposes a per-document extraction coverage summary (missing + low confidence)', async () => {
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
              // filled, high confidence
              invoiceNumber: { value: 'INV-001', confidence: 0.95 },
              // filled, low confidence (< 0.5) → lowConfidenceFields
              exporterName: { value: 'KIOM GLOBAL LIMITED', confidence: 0.3 },
              // empty value → missingFields
              portOfLoading: { value: null, confidence: 0 },
              // plain filled value (no confidence wrapper)
              currency: 'USD',
              // plain empty value → missingFields
              incoterm: '',
              // items array is excluded from coverage counting
              items: [{ itemCode: 'A1', description: 'Thing' }],
            },
          },
        ]),
      );
      queryQueue.push(createResolvedChain([{ id: 1, aiExtractedData: {} }]));

      const comparison = await documentService.getComparison(1);
      const coverage = comparison.extractionCoverage.invoice;

      expect(coverage).not.toBeNull();
      // 5 scalar fields counted (items excluded): invoiceNumber, exporterName,
      // portOfLoading, currency, incoterm.
      expect(coverage!.totalFields).toBe(5);
      expect(coverage!.filledFields).toBe(3);
      expect(coverage!.missingFields).toEqual(
        expect.arrayContaining(['portOfLoading', 'incoterm']),
      );
      expect(coverage!.missingFields).toHaveLength(2);
      expect(coverage!.lowConfidenceFields).toEqual(['exporterName']);
      // 3 of 5 read → 60%.
      expect(coverage!.readPercent).toBe(60);
    });

    it('computes unmatchedInvoiceItems (Invoice items absent from the Packing List)', async () => {
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
              exporterName: 'KIOM GLOBAL LIMITED',
              items: [
                { itemCode: 'PI7752Y', description: 'Blouse', quantity: 100 },
                // Present in invoice, absent from PL → unmatchedInvoiceItems
                { itemCode: 'PI9999Z', description: 'Jacket', quantity: 10 },
              ],
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
              exporterName: 'KIOM GLOBAL LIMITED',
              items: [
                { itemCode: 'PI7752Y', quantity: 100 },
                // Present in PL, absent from invoice → unmatchedPlItems
                { itemCode: 'PI1111A', quantity: 5 },
              ],
            },
          },
        ]),
      );
      queryQueue.push(createResolvedChain([{ id: 1, aiExtractedData: {} }]));

      const comparison = await documentService.getComparison(1);

      expect(comparison.unmatchedInvoiceItems).toHaveLength(1);
      expect(comparison.unmatchedInvoiceItems[0]).toMatchObject({
        itemCode: 'PI9999Z',
        source: 'invoice',
      });
      expect(comparison.unmatchedPlItems).toHaveLength(1);
      expect(comparison.unmatchedPlItems[0]).toMatchObject({
        itemCode: 'PI1111A',
        source: 'packing_list',
      });
    });
  });

  describe('getProformasAggregate()', () => {
    it('surfaces items, totalFobValue and a downloadable file reference per proforma', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 42,
            type: 'proforma_invoice',
            originalFilename: 'PI-001.pdf',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            confidenceScore: '0.91',
            aiParsedData: {
              // no piNumber → skips the preConsItems lookup query
              invoiceDate: '2026-01-01',
              currency: 'USD',
              totalFobValue: 1234.56,
              items: [
                { itemCode: 'A1', description: 'Thing', quantity: 10 },
                { itemCode: 'A2', description: 'Other', quantity: 5 },
              ],
            },
          },
        ]),
      );

      const result = await documentService.getProformasAggregate(7);
      expect(result.proformaCount).toBe(1);
      const pi = result.proformas[0];
      expect(pi.documentId).toBe(42);
      expect(pi.fileUrl).toBe('/api/documents/42/file');
      expect(pi.totalFobValue).toBe(1234.56);
      expect(pi.itemCount).toBe(2);
      expect(pi.items).toHaveLength(2);
      expect(result.totals.totalFobValue).toBe(1234.56);
      expect(result.totals.itemCount).toBe(2);
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

    describe('planilha: ruido e teto de tamanho', () => {
      // Quando alguem formata uma coluna inteira, o range usado vai ate a
      // ultima linha da planilha e o CSV vira centenas de milhares de linhas
      // de virgulas. Um xlsx de 27 KB gerava prompt suficiente para estourar
      // o teto de 180 s da extracao — 3 dos 4 timeouts de producao.
      const csvMock = async () =>
        (await import('xlsx')).utils.sheet_to_csv as unknown as ReturnType<typeof vi.fn>;

      it('descarta linhas que so tem separador', async () => {
        (await csvMock()).mockReturnValueOnce('sku,qtd\nA1,10\n,,,\n,,\nB2,5\n');

        const result = await documentService.extractText('/tmp/t.xlsx', 'application/vnd.ms-excel');

        expect(result.text).toBe('sku,qtd\nA1,10\nB2,5');
      });

      it('trunca acima do teto e diz que truncou', async () => {
        process.env.DOCUMENT_SPREADSHEET_MAX_CHARS = '50';
        (await csvMock()).mockReturnValueOnce('x'.repeat(500));

        const result = await documentService.extractText('/tmp/t.xlsx', 'application/vnd.ms-excel');

        expect(result.text).toContain('[TEXTO TRUNCADO');
        expect(result.text.length).toBeLessThan(200);
        delete process.env.DOCUMENT_SPREADSHEET_MAX_CHARS;
      });

      it('nao trunca planilha dentro do teto', async () => {
        (await csvMock()).mockReturnValueOnce('sku,qtd\nA1,10');

        const result = await documentService.extractText('/tmp/t.xlsx', 'application/vnd.ms-excel');

        expect(result.text).not.toContain('TRUNCADO');
      });
    });

    describe('scanned PDF on a provider that cannot read PDF parts', () => {
      // Regression guard for the "a maioria dos campos está trazendo só um
      // '-'" report: a scanned PDF was handed to Ollama/OpenRouter as
      // `data:application/pdf;base64,...`, which they cannot decode, so the
      // extraction "succeeded" with almost every field empty.
      const setProvider = (acceptsPdfInput: boolean, providerName = 'ialocal') => {
        Object.defineProperty(aiService, 'acceptsPdfInput', {
          value: acceptsPdfInput,
          configurable: true,
        });
        Object.defineProperty(aiService, 'providerName', {
          value: providerName,
          configurable: true,
        });
      };

      afterEach(() => setProvider(true, 'vertex'));

      it('sends rasterized PNG pages instead of the raw PDF', async () => {
        setProvider(false);
        const pdfParse = (await import('pdf-parse')).default as unknown as ReturnType<typeof vi.fn>;
        pdfParse.mockResolvedValueOnce({ text: '', numpages: 2 });
        vi.mocked(rasterizePdfPages).mockResolvedValueOnce(['page1b64', 'page2b64']);

        const result = await documentService.extractText('/tmp/scan.pdf', 'application/pdf');

        expect(result.imageMimeType).toBe('image/png');
        expect(result.imageBase64).toBe('page1b64');
        expect(result.additionalImagesBase64).toEqual(['page2b64']);
      });

      it('fails loudly when it cannot rasterize, instead of returning empty fields', async () => {
        setProvider(false);
        const pdfParse = (await import('pdf-parse')).default as unknown as ReturnType<typeof vi.fn>;
        pdfParse.mockResolvedValueOnce({ text: '', numpages: 1 });
        vi.mocked(rasterizePdfPages).mockResolvedValueOnce(null);

        await expect(
          documentService.extractText('/tmp/scan.pdf', 'application/pdf'),
        ).rejects.toThrow(/rasterizar/i);
      });

      it('still sends the raw PDF when the provider accepts it', async () => {
        setProvider(true, 'vertex');
        const pdfParse = (await import('pdf-parse')).default as unknown as ReturnType<typeof vi.fn>;
        pdfParse.mockResolvedValueOnce({ text: '', numpages: 1 });

        const result = await documentService.extractText('/tmp/scan.pdf', 'application/pdf');

        expect(result.imageMimeType).toBe('application/pdf');
        expect(rasterizePdfPages).not.toHaveBeenCalled();
      });

      it('prefers OCR text over rasterization when OCR is available', async () => {
        setProvider(false);
        const pdfParse = (await import('pdf-parse')).default as unknown as ReturnType<typeof vi.fn>;
        pdfParse.mockResolvedValueOnce({ text: '', numpages: 1 });
        vi.mocked(ocrScannedPdf).mockResolvedValueOnce({
          text: 'INVOICE 123',
          pageTexts: ['INVOICE 123'],
          pageCount: 1,
        });

        const result = await documentService.extractText('/tmp/scan.pdf', 'application/pdf');

        expect(result.text).toBe('INVOICE 123');
        expect(rasterizePdfPages).not.toHaveBeenCalled();
      });
    });

    it('uses bounded local OCR text for a scanned PDF when available', async () => {
      const pdfParse = (await import('pdf-parse')).default as unknown as ReturnType<typeof vi.fn>;
      pdfParse.mockResolvedValueOnce({ text: '' });
      vi.mocked(ocrScannedPdf).mockResolvedValueOnce({
        text: 'INVOICE 123\n\f\nTOTAL USD 100',
        pageTexts: ['INVOICE 123', 'TOTAL USD 100'],
        pageCount: 2,
      });

      const result = await documentService.extractText('/tmp/scanned.pdf', 'application/pdf');

      expect(result).toMatchObject({
        text: 'INVOICE 123\n\f\nTOTAL USD 100',
        pageTexts: ['INVOICE 123', 'TOTAL USD 100'],
        ocrUsed: true,
      });
      expect(ocrScannedPdf).toHaveBeenCalledWith('/tmp/scanned.pdf');
    });
  });
});
