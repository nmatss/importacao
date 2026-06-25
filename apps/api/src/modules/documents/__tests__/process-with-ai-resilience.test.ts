import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

const alertCreate = vi.fn().mockResolvedValue({});
vi.mock('../../alerts/service.js', () => ({
  alertService: { create: alertCreate },
}));

// AIBudgetExceededError must be the real class so `instanceof` works in the
// service catch block. extract* are stubbed per-test.
const extractInvoiceData = vi.fn();
const extractPackingListData = vi.fn();
const extractEspelhoData = vi.fn();
const extractProformaData = vi.fn();
vi.mock('../../ai/service.js', async () => {
  const { AIBudgetExceededError } = await import('../../ai/cost-pricing.js');
  return {
    AIBudgetExceededError,
    flattenAiData: (d: Record<string, any>) => d,
    aiService: {
      extractInvoiceData,
      extractPackingListData,
      extractEspelhoData,
      extractProformaData,
    },
  };
});

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

// Deterministic espelho parser — forced to "unrecognised layout" so the
// AI-fallback branch (and its provider guard) is exercised.
const tryParseEspelhoBuffer = vi.fn();
vi.mock('../../espelho-parser/parser.js', () => ({
  tryParseEspelhoBuffer,
}));

const mockFsReadFile = vi.fn().mockResolvedValue(Buffer.from('mock content'));
vi.mock('fs/promises', () => ({
  default: {
    readFile: mockFsReadFile,
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({ text: 'Extracted PDF text long enough to be real content' }),
}));

vi.mock('xlsx', () => ({
  read: vi.fn().mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
  utils: { sheet_to_csv: vi.fn().mockReturnValue('col1,col2\nval1,val2') },
}));

const { documentService } = await import('../service.js');
const { AIBudgetExceededError } = await import('../../ai/cost-pricing.js');

describe('processWithAI — extraction failure resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });
  afterEach(() => {
    delete process.env.ESPELHO_AI_FALLBACK;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_ALLOW_EXTERNAL;
    delete process.env.DOCUMENT_AI_EXTRACTION_TIMEOUT_MS;
    vi.useRealTimers();
  });

  it('marks document as extractionFailed and raises a critical alert when extraction throws', async () => {
    extractInvoiceData.mockRejectedValueOnce(new Error('All AI models in fallback chain failed'));

    const doc = {
      id: 7,
      processId: 42,
      type: 'invoice',
      storagePath: '/tmp/inv.pdf',
      mimeType: 'application/pdf',
      isProcessed: false,
      aiParsedData: null,
      confidenceScore: null,
      originalFilename: 'inv.pdf',
    };

    // select doc
    queryQueue.push(createResolvedChain([doc]));
    // catch: update documents (mark failed)
    const failUpdate = createResolvedChain(undefined);
    queryQueue.push(failUpdate);
    // catch: select processCode for alert
    queryQueue.push(createResolvedChain([{ processCode: 'IMP-042' }]));
    // catch: select processRow aiExtractedData for degradable gate
    queryQueue.push(createResolvedChain([{ aiExtractedData: {} }]));

    await documentService.processWithAI(7, 'invoice');

    // Document was marked processed-with-failure
    expect(failUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        aiParsedData: expect.objectContaining({ extractionFailed: true }),
        confidenceScore: '0',
        isProcessed: true,
      }),
    );

    // A critical alert was created
    expect(alertCreate).toHaveBeenCalledWith(
      expect.objectContaining({ processId: 42, severity: 'critical' }),
    );
  });

  it('marks document as extractionFailed when AI returns no meaningful data', async () => {
    extractInvoiceData.mockResolvedValueOnce({
      data: {
        invoiceNumber: { value: null, confidence: 0 },
        exporterName: { value: '', confidence: 0 },
        items: [],
      },
      confidenceScore: 0.91,
    });

    const doc = {
      id: 17,
      processId: 42,
      type: 'invoice',
      storagePath: '/tmp/inv-empty.pdf',
      mimeType: 'application/pdf',
      isProcessed: false,
      aiParsedData: null,
      confidenceScore: null,
      originalFilename: 'inv-empty.pdf',
    };

    queryQueue.push(createResolvedChain([doc]));
    const failUpdate = createResolvedChain(undefined);
    queryQueue.push(failUpdate);
    queryQueue.push(createResolvedChain([{ processCode: 'IMP-042' }]));
    queryQueue.push(createResolvedChain([{ aiExtractedData: {} }]));

    await documentService.processWithAI(17, 'invoice');

    expect(failUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        aiParsedData: expect.objectContaining({
          extractionFailed: true,
          reason: expect.stringContaining('sem dados úteis'),
        }),
        confidenceScore: '0',
        isProcessed: true,
      }),
    );
    expect(alertCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        processId: 42,
        severity: 'critical',
        title: 'Falha na extração de IA',
      }),
    );
  });

  it('flags budgetExceeded when extraction throws AIBudgetExceededError', async () => {
    extractInvoiceData.mockRejectedValueOnce(new AIBudgetExceededError(250, 200));

    const doc = {
      id: 8,
      processId: 43,
      type: 'invoice',
      storagePath: '/tmp/inv.pdf',
      mimeType: 'application/pdf',
      isProcessed: false,
      aiParsedData: null,
      confidenceScore: null,
      originalFilename: 'inv.pdf',
    };

    queryQueue.push(createResolvedChain([doc]));
    const failUpdate = createResolvedChain(undefined);
    queryQueue.push(failUpdate);
    queryQueue.push(createResolvedChain([{ processCode: 'IMP-043' }]));
    queryQueue.push(createResolvedChain([{ aiExtractedData: {} }]));

    await documentService.processWithAI(8, 'invoice');

    expect(failUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        aiParsedData: expect.objectContaining({ extractionFailed: true, budgetExceeded: true }),
      }),
    );
    expect(alertCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        title: expect.stringContaining('orçamento'),
      }),
    );
  });

  it('marks document as failed when PDF/text extraction throws before the AI call', async () => {
    mockFsReadFile.mockRejectedValueOnce(new Error('ENOENT: file not found'));

    const doc = {
      id: 10,
      processId: 44,
      type: 'invoice',
      storagePath: '/tmp/missing.pdf',
      mimeType: 'application/pdf',
      isProcessed: false,
      aiParsedData: null,
      confidenceScore: null,
      originalFilename: 'missing.pdf',
    };

    queryQueue.push(createResolvedChain([doc]));
    const failUpdate = createResolvedChain(undefined);
    queryQueue.push(failUpdate);
    queryQueue.push(createResolvedChain([{ processCode: 'IMP-044' }]));
    queryQueue.push(createResolvedChain([{ aiExtractedData: {} }]));

    await documentService.processWithAI(10, 'invoice');

    expect(extractInvoiceData).not.toHaveBeenCalled();
    expect(failUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        aiParsedData: expect.objectContaining({
          extractionFailed: true,
          reason: expect.stringContaining('ENOENT'),
        }),
        isProcessed: true,
      }),
    );
  });

  it('marks document as failed when AI extraction exceeds the operational timeout', async () => {
    vi.useFakeTimers();
    process.env.DOCUMENT_AI_EXTRACTION_TIMEOUT_MS = '10';
    extractInvoiceData.mockReturnValueOnce(new Promise(() => {}));

    const doc = {
      id: 14,
      processId: 45,
      type: 'invoice',
      storagePath: '/tmp/slow-inv.pdf',
      mimeType: 'application/pdf',
      isProcessed: false,
      aiParsedData: null,
      confidenceScore: null,
      originalFilename: 'slow-inv.pdf',
    };

    queryQueue.push(createResolvedChain([doc]));
    const failUpdate = createResolvedChain(undefined);
    queryQueue.push(failUpdate);
    queryQueue.push(createResolvedChain([{ processCode: 'IMP-045' }]));
    queryQueue.push(createResolvedChain([{ aiExtractedData: {} }]));

    const processing = documentService.processWithAI(14, 'invoice');
    await vi.advanceTimersByTimeAsync(11);
    await processing;

    expect(failUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        aiParsedData: expect.objectContaining({
          extractionFailed: true,
          reason: expect.stringContaining('Tempo limite operacional de extração IA excedido'),
        }),
        confidenceScore: '0',
        isProcessed: true,
      }),
    );
  });

  it('returns failed status for stale processing and structured extraction failures', async () => {
    const staleDate = new Date(Date.now() - 31 * 60 * 1000);
    queryQueue.push(
      createResolvedChain([
        {
          id: 11,
          processId: 44,
          type: 'invoice',
          originalFilename: 'stale.pdf',
          storagePath: '/tmp/stale.pdf',
          mimeType: 'application/pdf',
          fileSize: 1,
          driveFileId: null,
          aiParsedData: null,
          confidenceScore: null,
          isProcessed: false,
          createdAt: staleDate,
          updatedAt: staleDate,
        },
        {
          id: 12,
          processId: 44,
          type: 'packing_list',
          originalFilename: 'failed.pdf',
          storagePath: '/tmp/failed.pdf',
          mimeType: 'application/pdf',
          fileSize: 1,
          driveFileId: null,
          aiParsedData: { extractionFailed: true, reason: 'AI failed' },
          confidenceScore: '0',
          isProcessed: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    );

    const docs = await documentService.getByProcess(44);

    expect(docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 11, aiProcessingStatus: 'failed' }),
        expect.objectContaining({ id: 12, aiProcessingStatus: 'failed' }),
      ]),
    );
  });

  it('stores very-low-confidence extraction without projecting it into process data', async () => {
    extractPackingListData.mockResolvedValueOnce({
      data: { packingListNumber: 'PL-LOW' },
      confidenceScore: 0.39,
      fieldsWithLowConfidence: ['packingListNumber'],
    });

    const doc = {
      id: 13,
      processId: 45,
      type: 'packing_list',
      storagePath: '/tmp/pl.pdf',
      mimeType: 'application/pdf',
      isProcessed: false,
      aiParsedData: null,
      confidenceScore: null,
      originalFilename: 'pl.pdf',
    };

    queryQueue.push(createResolvedChain([doc])); // select doc
    const docUpdate = createResolvedChain(undefined);
    queryQueue.push(docUpdate); // update document with evidence
    queryQueue.push(createResolvedChain([{ processCode: 'IMP-045', aiExtractedData: {} }])); // alert/gate context

    await documentService.processWithAI(13, 'packing_list');

    expect(docUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        aiParsedData: { packingListNumber: 'PL-LOW' },
        confidenceScore: '0.39',
        isProcessed: true,
      }),
    );
    expect(alertCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        processId: 45,
        severity: 'critical',
        title: 'Extração IA com Confiança Muito Baixa',
      }),
    );
    // document update + comparison acceptance invalidation after a new extraction
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });
});

describe('processEspelho — ESPELHO_AI_FALLBACK provider guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    tryParseEspelhoBuffer.mockReturnValue({ ok: false, error: 'unrecognised layout' });
  });
  afterEach(() => {
    delete process.env.ESPELHO_AI_FALLBACK;
    delete process.env.AI_PROVIDER;
  });

  const espelhoDoc = {
    id: 9,
    processId: 50,
    type: 'espelho',
    storagePath: '/tmp/esp.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    isProcessed: false,
    aiParsedData: null,
    confidenceScore: null,
    originalFilename: 'esp.xlsx',
  };

  it('does NOT run the AI fallback when flag is on but provider is external without opt-in', async () => {
    process.env.ESPELHO_AI_FALLBACK = '1';
    process.env.AI_PROVIDER = 'openrouter';

    // select doc (processWithAI)
    queryQueue.push(createResolvedChain([espelhoDoc]));
    // parse-failed path: update documents with error
    queryQueue.push(createResolvedChain(undefined));
    // select processCode for parse-failed alert
    queryQueue.push(createResolvedChain([{ processCode: 'IMP-050' }]));

    await documentService.processWithAI(9, 'espelho');

    // The sensitive Pre-Cons data must NOT leave the perimeter without explicit opt-in.
    expect(extractEspelhoData).not.toHaveBeenCalled();
  });

  it('runs the AI fallback when flag is on AND provider is ialocal', async () => {
    process.env.ESPELHO_AI_FALLBACK = '1';
    process.env.AI_PROVIDER = 'ialocal';
    extractEspelhoData.mockResolvedValueOnce({
      data: { items: [] },
      confidenceScore: 0.9,
      fieldsWithLowConfidence: [],
    });

    // select doc
    queryQueue.push(createResolvedChain([espelhoDoc]));
    // update documents with fallback result
    queryQueue.push(createResolvedChain(undefined));
    // update importProcesses (espelho patch)
    queryQueue.push(createResolvedChain(undefined));

    await documentService.processWithAI(9, 'espelho');

    expect(extractEspelhoData).toHaveBeenCalledTimes(1);
  });

  it('runs the AI fallback with Vertex only after external-provider opt-in', async () => {
    process.env.ESPELHO_AI_FALLBACK = '1';
    process.env.AI_PROVIDER = 'vertex';
    process.env.AI_ALLOW_EXTERNAL = 'true';
    extractEspelhoData.mockResolvedValueOnce({
      data: { items: [] },
      confidenceScore: 0.9,
      fieldsWithLowConfidence: [],
    });

    queryQueue.push(createResolvedChain([espelhoDoc]));
    queryQueue.push(createResolvedChain(undefined));
    queryQueue.push(createResolvedChain(undefined));

    await documentService.processWithAI(9, 'espelho');

    expect(extractEspelhoData).toHaveBeenCalledTimes(1);
  });
});
