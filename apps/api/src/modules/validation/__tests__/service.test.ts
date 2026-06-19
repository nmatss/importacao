import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue, txQueue } = createMockDb();
const aiServiceMocks = vi.hoisted(() => ({
  detectAnomalies: vi.fn(),
  flattenAiData: vi.fn((data: Record<string, unknown>) => data),
}));
const mockGetOperationalRecipient = vi.hoisted(() => vi.fn());
const mockGetComparison = vi.hoisted(() => vi.fn());

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../communications/service.js', () => ({
  communicationService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../communications/templates/kiom-correction.js', () => ({
  kiomCorrectionTemplate: vi.fn().mockReturnValue({ subject: 'Correction', body: 'Body' }),
}));

vi.mock('../../settings/operational-recipients.js', () => ({
  getOperationalRecipient: (...args: any[]) => mockGetOperationalRecipient(...args),
}));

vi.mock('../../ai/service.js', () => ({
  aiService: { detectAnomalies: aiServiceMocks.detectAnomalies },
  flattenAiData: aiServiceMocks.flattenAiData,
}));

// documentService.getComparison is consumed read-only by runAnomalyDetection to
// reconcile AI item-presence anomalies with the deterministic unmatched set.
vi.mock('../../documents/service.js', () => ({
  documentService: { getComparison: mockGetComparison },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/state-machine/process-states.js', () => ({
  assertTransition: vi.fn(),
}));

vi.mock('../../../shared/utils/process-events.js', () => ({
  recordProcessEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock allChecks to return predictable results
const mockPassingCheck = vi.fn().mockReturnValue({
  checkName: 'mock-check',
  status: 'passed',
  documentsCompared: 'INV vs PL',
  message: 'OK',
});

const mockFailingCheck = vi.fn().mockReturnValue({
  checkName: 'fob-value-match',
  status: 'failed',
  expectedValue: '1000',
  actualValue: '900',
  documentsCompared: 'INV vs PL',
  message: 'Mismatch',
});

const completeCoreDocs = [
  { type: 'invoice', isProcessed: true, aiParsedData: { invoiceNumber: 'INV-001' } },
  { type: 'packing_list', isProcessed: true, aiParsedData: { packingListNumber: 'PL-001' } },
  { type: 'ohbl', isProcessed: true, aiParsedData: { blNumber: 'BL-001' } },
];

vi.mock('../checks/index.js', () => ({
  allChecks: [mockPassingCheck],
}));

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    isConfigured: vi.fn().mockResolvedValue(false),
    isRootConfigured: vi.fn().mockResolvedValue(false),
    moveToCorrection: vi.fn().mockResolvedValue(undefined),
    moveFromCorrection: vi.fn().mockResolvedValue(undefined),
  },
}));

const { validationService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');
const { alertService } = await import('../../alerts/service.js');
const { allChecks } = await import('../checks/index.js');

describe('validationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
    aiServiceMocks.detectAnomalies.mockReset();
    aiServiceMocks.detectAnomalies.mockResolvedValue({ anomalies: [] });
    aiServiceMocks.flattenAiData.mockImplementation((data: Record<string, unknown>) => data);
    mockGetOperationalRecipient.mockResolvedValue('kiom@example.com');
    mockGetComparison.mockReset();
    mockGetComparison.mockResolvedValue({ unmatchedPlItems: [], unmatchedInvoiceItems: [] });
    // Reset allChecks to default passing check
    (allChecks as any).length = 0;
    (allChecks as any).push(mockPassingCheck);
  });

  afterEach(async () => {
    // runAllChecks intentionally fires Google Chat/Drive notifications in the
    // background. Let those promises consume the mock DB fallback before the
    // next test resets and repopulates queryQueue.
    await new Promise((resolve) => setImmediate(resolve));
  });

  describe('runAllChecks()', () => {
    it('should throw error for invalid processId', async () => {
      await expect(validationService.runAllChecks(NaN)).rejects.toThrow('ID do processo invalido');
    });

    it('should throw NotFoundError for non-existent process', async () => {
      // select process returns empty
      queryQueue.push(createResolvedChain([]));

      await expect(validationService.runAllChecks(999)).rejects.toThrow('nao encontrado');
    });

    it('should run all checks and store results', async () => {
      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      // 1. select process
      queryQueue.push(createResolvedChain([mockProcess]));
      // 2. select documents
      queryQueue.push(createResolvedChain(completeCoreDocs));
      // 3. select followUp
      queryQueue.push(createResolvedChain([]));
      // 4. update process to validating
      queryQueue.push(createResolvedChain(undefined));
      // 5. transaction (validation run + delete + insert + corrections) - handled via txQueue
      txQueue.push(createResolvedChain([{ id: 100 }])); // insert validation run
      txQueue.push(createResolvedChain([])); // tx select previous
      txQueue.push(createResolvedChain(undefined)); // delete live results
      txQueue.push(createResolvedChain(undefined)); // insert live results
      txQueue.push(createResolvedChain(undefined)); // delete corrections
      txQueue.push(createResolvedChain(undefined)); // insert corrections
      // 7. update process to validated (no failures)
      queryQueue.push(createResolvedChain(undefined));
      // 8. update followUp preInspection
      queryQueue.push(createResolvedChain(undefined));

      const results = await validationService.runAllChecks(1, 1);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        checkName: 'document-set-completeness',
        status: 'passed',
      });
      expect(mockDb.transaction).toHaveBeenCalledOnce();
      expect(auditService.log).toHaveBeenCalledWith(
        1,
        'validation_run',
        'process',
        1,
        expect.objectContaining({ total: 2, passed: 2, failed: 0, validationRunId: 100 }),
        null,
      );
    });

    it('should fail final validation when core documents are not usable', async () => {
      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(createResolvedChain([])); // no usable documents
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      txQueue.push(createResolvedChain([{ id: 106 }])); // insert validation run
      txQueue.push(createResolvedChain([])); // tx select previous
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert
      txQueue.push(createResolvedChain(undefined)); // tx delete corrections
      txQueue.push(createResolvedChain(undefined)); // tx insert corrections
      queryQueue.push(createResolvedChain(undefined)); // update correctionStatus

      const results = await validationService.runAllChecks(1, 1);

      expect(results[0]).toMatchObject({
        checkName: 'document-set-completeness',
        status: 'failed',
      });
      expect(results.some((r) => r.status === 'failed')).toBe(true);
      expect(alertService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 1,
          title: expect.stringContaining('Falhas na Validacao'),
        }),
      );
    });

    it('should keep partial validation diagnostic without final side effects', async () => {
      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(
        createResolvedChain([
          { type: 'invoice', isProcessed: true, aiParsedData: { invoiceNumber: 'INV-001' } },
        ]),
      ); // partial documents
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain([{ id: 107 }])); // insert validation run

      const results = await validationService.runAllChecks(1, null, { mode: 'partial' });

      expect(results[0]).toMatchObject({
        checkName: 'document-set-completeness',
        status: 'warning',
      });
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(alertService.create).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'validation_run',
        'process',
        1,
        expect.objectContaining({ mode: 'partial', validationRunId: 107 }),
        null,
      );
    });

    it('should use Draft BL as validation BL data when OHBL is absent', async () => {
      const check = vi.fn().mockReturnValue({
        checkName: 'mock-check',
        status: 'passed',
        documentsCompared: 'INV vs PL vs BL',
        message: 'OK',
      });
      (allChecks as any).length = 0;
      (allChecks as any).push(check);

      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(
        createResolvedChain([
          { type: 'invoice', aiParsedData: { invoiceNumber: 'INV-001' } },
          { type: 'packing_list', aiParsedData: { totalPackages: 10 } },
          {
            type: 'draft_bl',
            aiParsedData: { blNumber: 'DRAFT-001', portOfLoading: 'Ningbo' },
          },
        ]),
      ); // docs
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      txQueue.push(createResolvedChain([{ id: 101 }])); // insert validation run
      txQueue.push(createResolvedChain([])); // tx select previous
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert
      txQueue.push(createResolvedChain(undefined)); // tx delete corrections
      txQueue.push(createResolvedChain(undefined)); // tx insert corrections
      queryQueue.push(createResolvedChain(undefined)); // update to validated
      queryQueue.push(createResolvedChain(undefined)); // update followUp

      await validationService.runAllChecks(1);

      expect(check).toHaveBeenCalledWith(
        expect.objectContaining({
          blData: { blNumber: 'DRAFT-001', portOfLoading: 'Ningbo' },
        }),
      );
    });

    it('should prefer OHBL over Draft BL for validation BL data', async () => {
      const check = vi.fn().mockReturnValue({
        checkName: 'mock-check',
        status: 'passed',
        documentsCompared: 'INV vs PL vs BL',
        message: 'OK',
      });
      (allChecks as any).length = 0;
      (allChecks as any).push(check);

      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(
        createResolvedChain([
          { type: 'draft_bl', aiParsedData: { blNumber: 'DRAFT-001' } },
          { type: 'invoice', aiParsedData: { invoiceNumber: 'INV-001' } },
          { type: 'packing_list', aiParsedData: { totalPackages: 10 } },
          { type: 'ohbl', aiParsedData: { blNumber: 'FINAL-001' } },
        ]),
      ); // docs
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      txQueue.push(createResolvedChain([{ id: 102 }])); // insert validation run
      txQueue.push(createResolvedChain([])); // tx select previous
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert
      txQueue.push(createResolvedChain(undefined)); // tx delete corrections
      txQueue.push(createResolvedChain(undefined)); // tx insert corrections
      queryQueue.push(createResolvedChain(undefined)); // update to validated
      queryQueue.push(createResolvedChain(undefined)); // update followUp

      await validationService.runAllChecks(1);

      expect(check).toHaveBeenCalledWith(
        expect.objectContaining({
          blData: { blNumber: 'FINAL-001' },
        }),
      );
    });

    it('should ignore pending, failed and stale documents when building validation input', async () => {
      const check = vi.fn().mockReturnValue({
        checkName: 'mock-check',
        status: 'passed',
        documentsCompared: 'INV vs PL vs BL',
        message: 'OK',
      });
      (allChecks as any).length = 0;
      (allChecks as any).push(check);

      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(
        createResolvedChain([
          {
            id: 1,
            type: 'invoice',
            isProcessed: true,
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            aiParsedData: { invoiceNumber: 'INV-FAILED', extractionFailed: true },
          },
          {
            id: 2,
            type: 'invoice',
            isProcessed: false,
            updatedAt: new Date('2026-03-01T00:00:00Z'),
            aiParsedData: { invoiceNumber: 'INV-PENDING' },
          },
          {
            id: 3,
            type: 'invoice',
            isProcessed: true,
            updatedAt: new Date('2026-02-01T00:00:00Z'),
            aiParsedData: { invoiceNumber: 'INV-OLD' },
          },
          {
            id: 4,
            type: 'invoice',
            isProcessed: true,
            updatedAt: new Date('2026-04-01T00:00:00Z'),
            aiParsedData: { invoiceNumber: 'INV-NEW' },
          },
          {
            id: 8,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.39',
            updatedAt: new Date('2026-05-01T00:00:00Z'),
            aiParsedData: { invoiceNumber: 'INV-LOW' },
          },
          {
            id: 9,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.99',
            updatedAt: new Date('2026-06-01T00:00:00Z'),
            aiParsedData: {
              invoiceNumber: { value: null, confidence: 0 },
              exporterName: { value: '', confidence: 0 },
              items: [],
            },
          },
          {
            id: 5,
            type: 'packing_list',
            isProcessed: true,
            aiParsedData: { packingListNumber: 'PL-001' },
          },
          {
            id: 6,
            type: 'ohbl',
            isProcessed: true,
            updatedAt: new Date('2026-04-02T00:00:00Z'),
            aiParsedData: { blNumber: 'BL-FAILED', extractionFailed: true },
          },
          {
            id: 7,
            type: 'draft_bl',
            isProcessed: true,
            updatedAt: new Date('2026-03-15T00:00:00Z'),
            aiParsedData: { blNumber: 'DRAFT-VALID' },
          },
        ]),
      ); // docs
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      txQueue.push(createResolvedChain([{ id: 103 }])); // insert validation run
      txQueue.push(createResolvedChain([])); // tx select previous
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert
      txQueue.push(createResolvedChain(undefined)); // tx delete corrections
      txQueue.push(createResolvedChain(undefined)); // tx insert corrections
      queryQueue.push(createResolvedChain(undefined)); // update to validated
      queryQueue.push(createResolvedChain(undefined)); // update followUp

      await validationService.runAllChecks(1);

      expect(check).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceData: { invoiceNumber: 'INV-NEW' },
          packingListData: { packingListNumber: 'PL-001' },
          blData: { blNumber: 'DRAFT-VALID' },
        }),
      );
    });

    it('should set status to validated when no failures', async () => {
      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(createResolvedChain(completeCoreDocs)); // docs
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      txQueue.push(createResolvedChain([{ id: 104 }])); // insert validation run
      txQueue.push(createResolvedChain([])); // tx select previous
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert
      txQueue.push(createResolvedChain(undefined)); // tx delete corrections
      txQueue.push(createResolvedChain(undefined)); // tx insert corrections
      queryQueue.push(createResolvedChain(undefined)); // update to validated
      queryQueue.push(createResolvedChain(undefined)); // update followUp

      const results = await validationService.runAllChecks(1);

      expect(results.every((r) => r.status !== 'failed')).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should set correctionStatus when failures found', async () => {
      // Replace checks with a failing one
      (allChecks as any).length = 0;
      (allChecks as any).push(mockFailingCheck);

      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(createResolvedChain(completeCoreDocs)); // docs
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      txQueue.push(createResolvedChain([{ id: 105 }])); // insert validation run
      txQueue.push(createResolvedChain([])); // tx select previous
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert
      txQueue.push(createResolvedChain(undefined)); // tx delete corrections
      txQueue.push(createResolvedChain(undefined)); // tx insert corrections
      queryQueue.push(createResolvedChain(undefined)); // update correctionStatus

      const results = await validationService.runAllChecks(1);

      expect(results.some((r) => r.status === 'failed')).toBe(true);
      expect(alertService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 1,
          severity: expect.any(String),
        }),
      );
    });

    it('should not leave the process stuck in validating when a check throws', async () => {
      // A check that rejects mid-run must not leave the process in 'validating';
      // the run should revert the status to the originating state and re-throw.
      const throwingCheck = vi.fn().mockRejectedValue(new Error('check exploded'));
      (allChecks as any).length = 0;
      (allChecks as any).push(throwingCheck);

      const mockProcess = {
        id: 1,
        processCode: 'IMP-001',
        status: 'documents_received',
        correctionStatus: null,
      };

      queryQueue.push(createResolvedChain([mockProcess])); // process
      queryQueue.push(createResolvedChain([])); // docs
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      // check throws here → catch block runs:
      queryQueue.push(createResolvedChain([{ id: 1, status: 'validating' }])); // re-select current
      const revertChain = createResolvedChain(undefined); // update back to origin
      queryQueue.push(revertChain);

      await expect(validationService.runAllChecks(1)).rejects.toThrow('check exploded');

      // The status was reverted to the originating state, not left as 'validating'.
      expect(revertChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'documents_received' }),
      );
    });
  });

  describe('getResults()', () => {
    it('should return results for a process', async () => {
      const mockResults = [
        { id: 1, processId: 1, checkName: 'exporter-match', status: 'passed' },
        { id: 2, processId: 1, checkName: 'fob-value-match', status: 'failed' },
      ];

      queryQueue.push(createResolvedChain(mockResults));

      const results = await validationService.getResults(1);

      expect(results).toEqual(mockResults);
      expect(results).toHaveLength(2);
    });
  });

  describe('runAnomalyDetection()', () => {
    it('should pass flattened document data to the configured AI service', async () => {
      const anomalyResult = {
        anomalies: [
          { field: 'totalFobValue', description: 'Divergencia sintetica', severity: 'high' },
        ],
      };
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce(anomalyResult);
      queryQueue.push(
        createResolvedChain([
          { type: 'invoice', aiParsedData: { invoiceNumber: 'INV-001', totalFobValue: 100 } },
          { type: 'packing_list', aiParsedData: { totalItems: 1 } },
          { type: 'ohbl', aiParsedData: { blNumber: 'BL-001' } },
        ]),
      );

      const result = await validationService.runAnomalyDetection(261);

      expect(result).toEqual(anomalyResult);
      expect(aiServiceMocks.detectAnomalies).toHaveBeenCalledWith(
        { invoiceNumber: 'INV-001', totalFobValue: 100 },
        { totalItems: 1 },
        { blNumber: 'BL-001' },
      );
    });

    it('should pass Draft BL to anomaly detection when OHBL is absent', async () => {
      const anomalyResult = { anomalies: [] };
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce(anomalyResult);
      queryQueue.push(
        createResolvedChain([
          { type: 'invoice', aiParsedData: { invoiceNumber: 'INV-001' } },
          { type: 'packing_list', aiParsedData: { totalItems: 1 } },
          { type: 'draft_bl', aiParsedData: { blNumber: 'DRAFT-001' } },
        ]),
      );

      const result = await validationService.runAnomalyDetection(261);

      expect(result).toEqual(anomalyResult);
      expect(aiServiceMocks.detectAnomalies).toHaveBeenCalledWith(
        { invoiceNumber: 'INV-001' },
        { totalItems: 1 },
        { blNumber: 'DRAFT-001' },
      );
    });

    it('should prefer OHBL over Draft BL for anomaly detection', async () => {
      const anomalyResult = { anomalies: [] };
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce(anomalyResult);
      queryQueue.push(
        createResolvedChain([
          { type: 'invoice', aiParsedData: { invoiceNumber: 'INV-001' } },
          { type: 'packing_list', aiParsedData: { totalItems: 1 } },
          { type: 'draft_bl', aiParsedData: { blNumber: 'DRAFT-001' } },
          { type: 'ohbl', aiParsedData: { blNumber: 'FINAL-001' } },
        ]),
      );

      const result = await validationService.runAnomalyDetection(261);

      expect(result).toEqual(anomalyResult);
      expect(aiServiceMocks.detectAnomalies).toHaveBeenCalledWith(
        { invoiceNumber: 'INV-001' },
        { totalItems: 1 },
        { blNumber: 'FINAL-001' },
      );
    });

    it('should use newest usable documents for anomaly detection', async () => {
      const anomalyResult = { anomalies: [] };
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce(anomalyResult);
      queryQueue.push(
        createResolvedChain([
          {
            id: 1,
            type: 'invoice',
            isProcessed: true,
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            aiParsedData: { invoiceNumber: 'INV-OLD' },
          },
          {
            id: 2,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.90',
            updatedAt: new Date('2026-02-01T00:00:00Z'),
            aiParsedData: { invoiceNumber: 'INV-NEW' },
          },
          {
            id: 7,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.39',
            updatedAt: new Date('2026-03-01T00:00:00Z'),
            aiParsedData: { invoiceNumber: 'INV-LOW' },
          },
          {
            id: 8,
            type: 'invoice',
            isProcessed: true,
            confidenceScore: '0.99',
            updatedAt: new Date('2026-04-01T00:00:00Z'),
            aiParsedData: {
              invoiceNumber: { value: null, confidence: 0 },
              exporterName: { value: '', confidence: 0 },
              items: [],
            },
          },
          {
            id: 3,
            type: 'packing_list',
            isProcessed: false,
            updatedAt: new Date('2026-02-01T00:00:00Z'),
            aiParsedData: { packingListNumber: 'PL-PENDING' },
          },
          {
            id: 4,
            type: 'packing_list',
            isProcessed: true,
            updatedAt: new Date('2026-01-15T00:00:00Z'),
            aiParsedData: { packingListNumber: 'PL-VALID' },
          },
          {
            id: 5,
            type: 'ohbl',
            isProcessed: true,
            aiParsedData: { blNumber: 'BL-FAILED', extractionFailed: true },
          },
          {
            id: 6,
            type: 'draft_bl',
            isProcessed: true,
            aiParsedData: { blNumber: 'DRAFT-VALID' },
          },
        ]),
      );

      const result = await validationService.runAnomalyDetection(261);

      expect(result).toEqual(anomalyResult);
      expect(aiServiceMocks.detectAnomalies).toHaveBeenCalledWith(
        { invoiceNumber: 'INV-NEW' },
        { packingListNumber: 'PL-VALID' },
        { blNumber: 'DRAFT-VALID' },
      );
    });

    it('should return a controlled integration error when AI anomaly detection fails', async () => {
      aiServiceMocks.detectAnomalies.mockRejectedValueOnce(new Error('raw provider detail'));
      queryQueue.push(
        createResolvedChain([
          { type: 'invoice', aiParsedData: { invoiceNumber: 'INV-001' } },
          { type: 'packing_list', aiParsedData: {} },
          { type: 'ohbl', aiParsedData: {} },
        ]),
      );

      await expect(validationService.runAnomalyDetection(261)).rejects.toMatchObject({
        statusCode: 502,
        code: 'INTEGRATION_ERROR',
        message:
          'IA: deteccao de anomalias indisponivel; verifique o provider configurado e tente novamente',
      });
    });
  });

  describe('runAnomalyDetection() item reconciliation', () => {
    const itemDocs = () =>
      createResolvedChain([
        { type: 'invoice', aiParsedData: { invoiceNumber: 'INV-001', items: [{ itemCode: 'A' }] } },
        { type: 'packing_list', aiParsedData: { items: [{ itemCode: 'B' }] } },
        { type: 'ohbl', aiParsedData: { blNumber: 'BL-001' } },
      ]);

    it('suppresses AI item-presence anomalies when deterministic comparison finds none', async () => {
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce({
        anomalies: [
          { field: 'items.A', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'items.B', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'totalFobValue', description: 'Divergencia FOB', severity: 'high' },
        ],
      });
      mockGetComparison.mockResolvedValueOnce({ unmatchedPlItems: [] });
      queryQueue.push(itemDocs());

      const result = await validationService.runAnomalyDetection(261);

      // Only the non-item anomaly survives.
      expect(result.anomalies).toEqual([
        { field: 'totalFobValue', description: 'Divergencia FOB', severity: 'high' },
      ]);
    });

    it('re-emits a single anomaly whose count agrees with the deterministic unmatched set', async () => {
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce({
        anomalies: [
          { field: 'items.A', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'items.B', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'items.C', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'items.D', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'items.E', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'items.F', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'items.G', description: 'Item nao localizado no PL', severity: 'medium' },
        ],
      });
      // Deterministic comparison: only ONE real unmatched item.
      mockGetComparison.mockResolvedValueOnce({
        unmatchedPlItems: [{ itemCode: 'X', source: 'packing_list' }],
      });
      queryQueue.push(itemDocs());

      const result = await validationService.runAnomalyDetection(261);

      const itemAnomalies = result.anomalies.filter((a: any) =>
        String(a.field).startsWith('items'),
      );
      // The 7 fuzzy AI anomalies collapse to exactly one deterministic anomaly,
      // matching the panel count of 1.
      expect(itemAnomalies).toHaveLength(1);
      expect(itemAnomalies[0].description).toContain('1 item');
    });

    it('re-emits BOTH directions when PL and Invoice each have unmatched items', async () => {
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce({
        anomalies: [
          { field: 'items.A', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'items.B', description: 'Item nao localizado no PL', severity: 'medium' },
          { field: 'totalFobValue', description: 'Divergencia FOB', severity: 'high' },
        ],
      });
      mockGetComparison.mockResolvedValueOnce({
        unmatchedPlItems: [
          { itemCode: 'X', source: 'packing_list' },
          { itemCode: 'Y', source: 'packing_list' },
        ],
        unmatchedInvoiceItems: [{ itemCode: 'Z', source: 'invoice' }],
      });
      queryQueue.push(itemDocs());

      const result = await validationService.runAnomalyDetection(261);

      // Non-item anomaly passes through.
      expect(result.anomalies).toContainEqual({
        field: 'totalFobValue',
        description: 'Divergencia FOB',
        severity: 'high',
      });

      const itemAnomalies = result.anomalies.filter((a: any) =>
        String(a.field).startsWith('items'),
      );
      // Exactly one anomaly per direction — they no longer collapse into PL only.
      expect(itemAnomalies).toHaveLength(2);

      const plAnomaly = itemAnomalies.find((a: any) => a.field === 'items.unmatched');
      const invoiceAnomaly = itemAnomalies.find((a: any) => a.field === 'items.unmatched.invoice');
      expect(plAnomaly?.description).toContain('2 itens');
      expect(plAnomaly?.description).toContain('Packing List sem correspondencia na Invoice');
      expect(invoiceAnomaly?.description).toContain('1 item');
      expect(invoiceAnomaly?.description).toContain('Invoice sem correspondencia no Packing List');
    });

    it('emits only the Invoice direction when PL is fully matched but Invoice is not', async () => {
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce({
        anomalies: [
          { field: 'items.A', description: 'Item nao localizado no PL', severity: 'medium' },
        ],
      });
      mockGetComparison.mockResolvedValueOnce({
        unmatchedPlItems: [],
        unmatchedInvoiceItems: [{ itemCode: 'Z', source: 'invoice' }],
      });
      queryQueue.push(itemDocs());

      const result = await validationService.runAnomalyDetection(261);

      const itemAnomalies = result.anomalies.filter((a: any) =>
        String(a.field).startsWith('items'),
      );
      expect(itemAnomalies).toHaveLength(1);
      expect(itemAnomalies[0].field).toBe('items.unmatched.invoice');
      expect(itemAnomalies[0].description).toContain('1 item');
    });

    it('synthesizes deterministic item-presence anomalies even when the AI emits none', async () => {
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce({ anomalies: [] });
      mockGetComparison.mockResolvedValueOnce({
        unmatchedPlItems: [{ itemCode: 'PL-ONLY', source: 'packing_list' }],
        unmatchedInvoiceItems: [],
      });
      queryQueue.push(itemDocs());

      const result = await validationService.runAnomalyDetection(261);

      expect(result.anomalies).toEqual([
        expect.objectContaining({
          field: 'items.unmatched',
          description: expect.stringContaining('1 item'),
        }),
      ]);
    });

    it('keeps quantity-divergence anomalies (not an item-presence signal)', async () => {
      aiServiceMocks.detectAnomalies.mockResolvedValueOnce({
        anomalies: [{ field: 'items.A.quantity', description: 'Qtd divergente', severity: 'high' }],
      });
      queryQueue.push(itemDocs());

      const result = await validationService.runAnomalyDetection(261);

      expect(result.anomalies).toEqual([
        { field: 'items.A.quantity', description: 'Qtd divergente', severity: 'high' },
      ]);
      expect(mockGetComparison).toHaveBeenCalledWith(261);
    });
  });

  describe('getReport()', () => {
    const processWithSystemData = {
      id: 1,
      processCode: 'IMP-001',
      brand: 'X',
      status: 'validated',
      totalFobValue: '1000.00',
      freightValue: '200.00',
      totalCbm: '12.000',
      containerType: '40HC',
    };

    it('tags system_vs_document results and reports systemDataAvailable=true', async () => {
      queryQueue.push(createResolvedChain([processWithSystemData]));
      queryQueue.push(
        createResolvedChain([
          {
            checkName: 'invoice-value-vs-fup',
            status: 'passed',
            dataSource: 'system_vs_document',
            documentsCompared: 'Invoice vs Sistema',
          },
          {
            checkName: 'exporter-match',
            status: 'passed',
            dataSource: 'cross_document',
            documentsCompared: 'INV vs PL',
          },
        ]),
      );

      const report = await validationService.getReport(1);

      expect(report.systemDataAvailable).toBe(true);
      expect(report.systemChecks.map((c: any) => c.checkName)).toEqual(['invoice-value-vs-fup']);
      expect(report.crossDocumentChecks.map((c: any) => c.checkName)).toEqual(['exporter-match']);
    });

    it('falls back to documentsCompared when dataSource is null (legacy rows)', async () => {
      queryQueue.push(createResolvedChain([processWithSystemData]));
      queryQueue.push(
        createResolvedChain([
          {
            checkName: 'freight-vs-fup',
            status: 'passed',
            dataSource: null,
            documentsCompared: 'BL vs Sistema',
          },
        ]),
      );

      const report = await validationService.getReport(1);

      expect(report.systemChecks.map((c: any) => c.checkName)).toEqual(['freight-vs-fup']);
      expect(report.crossDocumentChecks).toHaveLength(0);
    });

    it('reports systemDataAvailable=false when no system reference data exists', async () => {
      queryQueue.push(
        createResolvedChain([
          {
            id: 2,
            processCode: 'IMP-002',
            brand: 'Y',
            status: 'validating',
            totalFobValue: null,
            freightValue: null,
            totalCbm: null,
            containerType: null,
          },
        ]),
      );
      queryQueue.push(createResolvedChain([]));

      const report = await validationService.getReport(2);

      expect(report.systemDataAvailable).toBe(false);
    });
  });

  describe('resolveManually()', () => {
    it('should require a resolution note', async () => {
      await expect(validationService.resolveManually(5, 3, '   ')).rejects.toThrow('obrigatoria');
    });

    it('should snapshot divergent value, store note and log detailed audit', async () => {
      const mockCurrent = {
        id: 5,
        processId: 1,
        checkName: 'fob-value-match',
        status: 'failed',
        actualValue: '900',
        expectedValue: '1000',
        resolvedManually: false,
      };
      const mockUpdated = {
        ...mockCurrent,
        resolvedManually: true,
        resolvedBy: 3,
        resolvedAt: new Date(),
        resolutionNote: 'Conferido manualmente',
      };

      // 1. select current row
      queryQueue.push(createResolvedChain([mockCurrent]));
      // 2. update + returning
      queryQueue.push(createResolvedChain([mockUpdated]));
      // 3. recompute: select all results (still has another unresolved failed → no promotion)
      queryQueue.push(
        createResolvedChain([
          mockUpdated,
          { id: 6, processId: 1, status: 'failed', resolvedManually: false },
        ]),
      );

      const result = await validationService.resolveManually(5, 3, 'Conferido manualmente');

      expect(result).toEqual(mockUpdated);
      expect(auditService.log).toHaveBeenCalledWith(
        3,
        'manual_resolution',
        'validation',
        5,
        expect.objectContaining({
          processId: 1,
          checkName: 'fob-value-match',
          divergentValue: '900',
          resolutionNote: 'Conferido manualmente',
        }),
        null,
      );
    });

    it('should promote process to validated when all failed checks are resolved', async () => {
      const mockCurrent = {
        id: 5,
        processId: 1,
        checkName: 'fob-value-match',
        status: 'failed',
        actualValue: '900',
        expectedValue: '1000',
        resolvedManually: false,
      };
      const mockUpdated = { ...mockCurrent, resolvedManually: true, resolvedBy: 3 };

      // 1. select current row
      queryQueue.push(createResolvedChain([mockCurrent]));
      // 2. update + returning
      queryQueue.push(createResolvedChain([mockUpdated]));
      // 3. recompute: select all results (only failed is now resolved)
      queryQueue.push(createResolvedChain([mockUpdated]));
      // 4. select process (status validating, pending_correction)
      queryQueue.push(
        createResolvedChain([
          {
            id: 1,
            processCode: 'IMP-001',
            brand: 'X',
            status: 'validating',
            correctionStatus: 'pending_correction',
          },
        ]),
      );
      // 5. update process to validated
      queryQueue.push(createResolvedChain(undefined));

      await validationService.resolveManually(5, 3, 'Conferido manualmente');

      // process update (to validated) was issued
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
