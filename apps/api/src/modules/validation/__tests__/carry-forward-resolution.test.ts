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

vi.mock('../../settings/operational-recipients.js', () => ({
  getOperationalRecipient: vi.fn().mockResolvedValue('kiom@example.com'),
}));

// A single FAILing check whose finding identity we can control per test by
// swapping the mock implementation.
const mockFailingCheck = vi.fn();

vi.mock('../checks/index.js', () => ({
  allChecks: [mockFailingCheck],
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

const completeCoreDocs = [
  { type: 'invoice', isProcessed: true, aiParsedData: { invoiceNumber: 'INV-001' } },
  { type: 'packing_list', isProcessed: true, aiParsedData: { packingListNumber: 'PL-001' } },
  { type: 'ohbl', isProcessed: true, aiParsedData: { blNumber: 'BL-001' } },
];

const mockProcess = {
  id: 1,
  processCode: 'IMP-001',
  status: 'documents_received',
  correctionStatus: 'pending_correction',
  brand: 'ACME',
};

/**
 * Queues every chain a single final runAllChecks() consumes, returning the
 * live-results insert chain so the test can inspect the carried-forward values.
 */
function queueRun(previousLiveRows: any[]) {
  queryQueue.push(createResolvedChain([mockProcess])); // select process
  queryQueue.push(createResolvedChain(completeCoreDocs)); // select documents
  queryQueue.push(createResolvedChain([])); // select followUp
  queryQueue.push(createResolvedChain(undefined)); // update to validating

  const runInsertChain = createResolvedChain([{ id: 901 }]); // tx insert validation run
  const selectPrevChain = createResolvedChain(previousLiveRows); // tx select previous live
  const historyInsertChain = createResolvedChain(undefined); // tx insert history
  const deleteChain = createResolvedChain(undefined); // tx delete live
  const liveInsertChain = createResolvedChain(undefined); // tx insert new live
  const correctionDeleteChain = createResolvedChain(undefined); // tx delete corrections
  const correctionInsertChain = createResolvedChain(undefined); // tx insert corrections
  txQueue.push(
    runInsertChain,
    selectPrevChain,
    historyInsertChain,
    deleteChain,
    liveInsertChain,
    correctionDeleteChain,
    correctionInsertChain,
  );

  // Process is left in pending_correction (the check still FAILs), so the only
  // remaining outer update is the correctionStatus write.
  queryQueue.push(createResolvedChain(undefined)); // update correctionStatus

  return { liveInsertChain };
}

/**
 * Variant of queueRun for the case where the re-computed check now PASSES.
 * With no failed checks the process clears pending_correction: the outer flow
 * updates importProcesses to 'validated' and then writes the pre-inspection
 * milestone, instead of the single correctionStatus write of queueRun.
 */
function queueRunPassing(previousLiveRows: any[]) {
  queryQueue.push(createResolvedChain([mockProcess])); // select process
  queryQueue.push(createResolvedChain(completeCoreDocs)); // select documents
  queryQueue.push(createResolvedChain([])); // select followUp
  queryQueue.push(createResolvedChain(undefined)); // update to validating

  const runInsertChain = createResolvedChain([{ id: 902 }]); // tx insert validation run
  const selectPrevChain = createResolvedChain(previousLiveRows); // tx select previous live
  const historyInsertChain = createResolvedChain(undefined); // tx insert history
  const deleteChain = createResolvedChain(undefined); // tx delete live
  const liveInsertChain = createResolvedChain(undefined); // tx insert new live
  const correctionDeleteChain = createResolvedChain(undefined); // tx delete corrections
  const correctionInsertChain = createResolvedChain(undefined); // tx insert corrections
  txQueue.push(
    runInsertChain,
    selectPrevChain,
    historyInsertChain,
    deleteChain,
    liveInsertChain,
    correctionDeleteChain,
    correctionInsertChain,
  );

  // No failed checks → clear pending_correction (update importProcesses to
  // 'validated') and write the pre-inspection milestone (followUpTracking).
  queryQueue.push(createResolvedChain(undefined)); // update importProcesses -> validated
  queryQueue.push(createResolvedChain(undefined)); // update followUpTracking milestone

  return { liveInsertChain };
}

describe('runAllChecks() carry-forward of manual resolutions (P1 data-loss)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });

  it('keeps a manually-resolved row resolved after a re-run when the finding is unchanged', async () => {
    // The re-computed check emits the SAME finding the operator accepted.
    mockFailingCheck.mockReturnValue({
      checkName: 'fob-value-match',
      status: 'failed',
      expectedValue: '1000',
      actualValue: '900',
      documentsCompared: 'INV vs PL',
      message: 'FOB diverge',
    });

    const resolvedAt = new Date('2026-06-10T10:00:00.000Z');
    const previousLiveRows = [
      {
        id: 10,
        processId: 1,
        validationRunId: 800,
        checkName: 'fob-value-match',
        status: 'failed',
        expectedValue: '1000',
        actualValue: '900',
        documentsCompared: 'INV vs PL',
        message: 'FOB diverge',
        dataSource: 'cross_document',
        resolvedManually: true,
        resolvedBy: 7,
        resolvedAt,
        resolutionNote: 'Aceito pela Eduarda',
        createdAt: resolvedAt,
      },
    ];

    const { liveInsertChain } = queueRun(previousLiveRows);

    await validationService.runAllChecks(1, 1);

    // document-set-completeness (passed) + fob-value-match (failed, carried).
    const insertedRows = liveInsertChain.values.mock.calls[0][0];
    const fob = insertedRows.find((r: any) => r.checkName === 'fob-value-match');

    expect(fob).toMatchObject({
      checkName: 'fob-value-match',
      status: 'failed',
      resolvedManually: true,
      resolvedBy: 7,
      resolvedAt,
      resolutionNote: 'Aceito pela Eduarda',
    });
  });

  it('does NOT inherit a stale resolution when the finding genuinely changed', async () => {
    // The re-computed check now reports a DIFFERENT actual value: a new finding.
    mockFailingCheck.mockReturnValue({
      checkName: 'fob-value-match',
      status: 'failed',
      expectedValue: '1000',
      actualValue: '500', // changed from the previously-accepted 900
      documentsCompared: 'INV vs PL',
      message: 'FOB diverge',
    });

    const resolvedAt = new Date('2026-06-10T10:00:00.000Z');
    const previousLiveRows = [
      {
        id: 10,
        processId: 1,
        validationRunId: 800,
        checkName: 'fob-value-match',
        status: 'failed',
        expectedValue: '1000',
        actualValue: '900', // operator accepted THIS divergence, not 500
        documentsCompared: 'INV vs PL',
        message: 'FOB diverge',
        dataSource: 'cross_document',
        resolvedManually: true,
        resolvedBy: 7,
        resolvedAt,
        resolutionNote: 'Aceito pela Eduarda',
        createdAt: resolvedAt,
      },
    ];

    const { liveInsertChain } = queueRun(previousLiveRows);

    await validationService.runAllChecks(1, 1);

    const insertedRows = liveInsertChain.values.mock.calls[0][0];
    const fob = insertedRows.find((r: any) => r.checkName === 'fob-value-match');

    expect(fob).toMatchObject({
      checkName: 'fob-value-match',
      status: 'failed',
      actualValue: '500',
      resolvedManually: false,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
    });
  });

  it('does NOT inherit a stale resolution when the finding now PASSES', async () => {
    // Same finding identity (check + documents + expected/actual) as the
    // operator-accepted row, but the re-computed status is now 'passed'. A
    // passing row must never carry resolvedManually=true forward.
    mockFailingCheck.mockReturnValue({
      checkName: 'fob-value-match',
      status: 'passed',
      expectedValue: '1000',
      actualValue: '900',
      documentsCompared: 'INV vs PL',
      message: 'FOB dentro da tolerancia',
    });

    const resolvedAt = new Date('2026-06-10T10:00:00.000Z');
    const previousLiveRows = [
      {
        id: 10,
        processId: 1,
        validationRunId: 800,
        checkName: 'fob-value-match',
        status: 'failed',
        expectedValue: '1000',
        actualValue: '900',
        documentsCompared: 'INV vs PL',
        message: 'FOB diverge',
        dataSource: 'cross_document',
        resolvedManually: true,
        resolvedBy: 7,
        resolvedAt,
        resolutionNote: 'Aceito pela Eduarda',
        createdAt: resolvedAt,
      },
    ];

    const { liveInsertChain } = queueRunPassing(previousLiveRows);

    await validationService.runAllChecks(1, 1);

    const insertedRows = liveInsertChain.values.mock.calls[0][0];
    const fob = insertedRows.find((r: any) => r.checkName === 'fob-value-match');

    expect(fob).toMatchObject({
      checkName: 'fob-value-match',
      status: 'passed',
      resolvedManually: false,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
    });
  });
});
