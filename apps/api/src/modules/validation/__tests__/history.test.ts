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

vi.mock('../../communications/service.js', () => ({
  communicationService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../communications/templates/kiom-correction.js', () => ({
  kiomCorrectionTemplate: vi.fn().mockReturnValue({ subject: 'Correction', body: 'Body' }),
}));

vi.mock('../../ai/service.js', () => ({
  aiService: { detectAnomalies: vi.fn().mockResolvedValue({ anomalies: [] }) },
  flattenAiData: vi.fn((d) => d),
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

const mockPassingCheck = vi.fn().mockReturnValue({
  checkName: 'mock-check',
  status: 'passed',
  documentsCompared: 'INV vs PL',
  message: 'OK',
});

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

describe('validation history (backlog #12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });

  describe('runAllChecks() snapshot', () => {
    const mockProcess = {
      id: 1,
      processCode: 'IMP-001',
      status: 'documents_received',
      correctionStatus: null,
    };

    it('writes the previous results to validation_result_history BEFORE deleting them', async () => {
      const previousRunAt = new Date('2026-06-01T10:00:00.000Z');
      const previousResults = [
        {
          id: 10,
          processId: 1,
          checkName: 'fob-value-match',
          status: 'failed',
          expectedValue: '1000',
          actualValue: '900',
          documentsCompared: 'INV vs PL',
          message: 'Mismatch',
          dataSource: 'cross_document',
          resolvedManually: true,
          resolvedBy: 3,
          resolvedAt: previousRunAt,
          resolutionNote: 'Aceite manual',
          createdAt: previousRunAt,
        },
        {
          id: 11,
          processId: 1,
          checkName: 'ports-match',
          status: 'passed',
          expectedValue: null,
          actualValue: null,
          documentsCompared: 'INV vs BL',
          message: 'OK',
          dataSource: 'cross_document',
          resolvedManually: false,
          resolvedBy: null,
          resolvedAt: null,
          resolutionNote: null,
          createdAt: previousRunAt,
        },
      ];

      queryQueue.push(createResolvedChain([mockProcess])); // select process
      queryQueue.push(createResolvedChain([])); // select documents
      queryQueue.push(createResolvedChain([])); // select followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating

      const selectPrevChain = createResolvedChain(previousResults); // tx select previous
      const historyInsertChain = createResolvedChain(undefined); // tx insert history
      const deleteChain = createResolvedChain(undefined); // tx delete live
      const insertChain = createResolvedChain(undefined); // tx insert new live
      txQueue.push(selectPrevChain, historyInsertChain, deleteChain, insertChain);

      queryQueue.push(createResolvedChain(undefined)); // update to validated
      queryQueue.push(createResolvedChain(undefined)); // update followUp

      const results = await validationService.runAllChecks(1, 1);

      expect(results).toHaveLength(1);
      expect(mockDb.transaction).toHaveBeenCalledOnce();

      // History insert happened (1st tx insert) with one snapshot row per check
      expect(mockTx.insert).toHaveBeenCalledTimes(2);
      expect(historyInsertChain.values).toHaveBeenCalledWith([
        expect.objectContaining({
          processId: 1,
          runAt: previousRunAt,
          checkName: 'fob-value-match',
          status: 'failed',
          message: 'Mismatch',
          resolvedManually: true,
          resolutionNote: 'Aceite manual',
          details: expect.objectContaining({
            expectedValue: '1000',
            actualValue: '900',
            documentsCompared: 'INV vs PL',
            resolvedBy: 3,
          }),
        }),
        expect.objectContaining({
          processId: 1,
          runAt: previousRunAt,
          checkName: 'ports-match',
          status: 'passed',
          resolvedManually: false,
        }),
      ]);

      // ...and STRICTLY BEFORE the delete of the live table
      const firstInsertOrder = mockTx.insert.mock.invocationCallOrder[0];
      const deleteOrder = mockTx.delete.mock.invocationCallOrder[0];
      expect(firstInsertOrder).toBeLessThan(deleteOrder);
    });

    it('does not write history when there are no previous results (first run)', async () => {
      queryQueue.push(createResolvedChain([mockProcess])); // select process
      queryQueue.push(createResolvedChain([])); // select documents
      queryQueue.push(createResolvedChain([])); // select followUp
      queryQueue.push(createResolvedChain(undefined)); // update to validating

      txQueue.push(createResolvedChain([])); // tx select previous → empty
      txQueue.push(createResolvedChain(undefined)); // tx delete
      txQueue.push(createResolvedChain(undefined)); // tx insert new

      queryQueue.push(createResolvedChain(undefined)); // update to validated
      queryQueue.push(createResolvedChain(undefined)); // update followUp

      await validationService.runAllChecks(1, 1);

      // Only the insert of the NEW live results — no history insert
      expect(mockTx.insert).toHaveBeenCalledTimes(1);
      expect(mockTx.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('getValidationHistory()', () => {
    it('groups rows by runAt (newest first) and paginates runs', async () => {
      const runA = new Date('2026-06-10T12:00:00.000Z');
      const runB = new Date('2026-06-05T08:00:00.000Z');
      const rows = [
        { id: 1, processId: 1, runAt: runA, checkName: 'fob-value-match', status: 'failed' },
        { id: 2, processId: 1, runAt: runA, checkName: 'ports-match', status: 'passed' },
        { id: 3, processId: 1, runAt: runB, checkName: 'fob-value-match', status: 'warning' },
      ];

      queryQueue.push(createResolvedChain(rows));

      const history = await validationService.getValidationHistory(1, 1, 10);

      expect(history.totalRuns).toBe(2);
      expect(history.runs).toHaveLength(2);
      expect(history.runs[0]).toMatchObject({
        runAt: runA.toISOString(),
        total: 2,
        passed: 1,
        failed: 1,
      });
      expect(history.runs[1]).toMatchObject({
        runAt: runB.toISOString(),
        total: 1,
        warnings: 1,
      });
    });

    it('applies simple pagination over runs', async () => {
      const rows = [
        {
          id: 1,
          processId: 1,
          runAt: new Date('2026-06-10T12:00:00.000Z'),
          checkName: 'a',
          status: 'passed',
        },
        {
          id: 2,
          processId: 1,
          runAt: new Date('2026-06-09T12:00:00.000Z'),
          checkName: 'a',
          status: 'passed',
        },
        {
          id: 3,
          processId: 1,
          runAt: new Date('2026-06-08T12:00:00.000Z'),
          checkName: 'a',
          status: 'passed',
        },
      ];

      queryQueue.push(createResolvedChain(rows));

      const history = await validationService.getValidationHistory(1, 2, 2);

      expect(history.totalRuns).toBe(3);
      expect(history.page).toBe(2);
      expect(history.pageSize).toBe(2);
      expect(history.runs).toHaveLength(1);
      expect(history.runs[0].runAt).toBe('2026-06-08T12:00:00.000Z');
    });
  });
});
