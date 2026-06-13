import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue, txQueue } = createMockDb();

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

vi.mock('../../ai/service.js', () => ({
  aiService: { detectAnomalies: vi.fn().mockResolvedValue({ anomalies: [] }) },
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

vi.mock('../checks/index.js', () => ({
  allChecks: [mockPassingCheck],
}));

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    isConfigured: vi.fn().mockResolvedValue(false),
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
    // Reset allChecks to default passing check
    (allChecks as any).length = 0;
    (allChecks as any).push(mockPassingCheck);
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
      queryQueue.push(createResolvedChain([]));
      // 3. select followUp
      queryQueue.push(createResolvedChain([]));
      // 4. update process to validating
      queryQueue.push(createResolvedChain(undefined));
      // 5. transaction (delete + insert) - handled via txQueue
      txQueue.push(createResolvedChain(undefined)); // delete
      txQueue.push(createResolvedChain(undefined)); // insert
      // 6. update process to validated (no failures)
      queryQueue.push(createResolvedChain(undefined));
      // 7. update followUp preInspection
      queryQueue.push(createResolvedChain(undefined));

      const results = await validationService.runAllChecks(1, 1);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('passed');
      expect(mockDb.transaction).toHaveBeenCalledOnce();
      expect(auditService.log).toHaveBeenCalledWith(
        1,
        'validation_run',
        'process',
        1,
        expect.objectContaining({ total: 1, passed: 1, failed: 0 }),
        null,
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
      queryQueue.push(createResolvedChain([])); // docs
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert
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
      queryQueue.push(createResolvedChain([])); // docs
      queryQueue.push(createResolvedChain([])); // followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert
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
