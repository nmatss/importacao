import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, mockTx, queryQueue, txQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

const { processService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');

describe('processService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });

  describe('create()', () => {
    it('should create a process and follow-up tracking in a transaction', async () => {
      const input = {
        processCode: 'IMP-2024-001',
        brand: 'puket' as const,
        incoterm: 'FOB',
        portOfLoading: 'Shanghai',
        portOfDischarge: 'Santos',
        etd: '2024-06-01',
        eta: '2024-07-15',
        exporterName: 'Test Exporter',
        exporterAddress: '123 Export St',
        importerName: 'Test Importer',
        importerAddress: '456 Import Ave',
        notes: 'Test notes',
      };

      const mockProcess = { id: 1, ...input, status: 'draft', createdBy: 1 };

      // tx.insert(importProcesses).values(...).returning()
      txQueue.push(createResolvedChain([mockProcess]));
      // tx.insert(followUpTracking).values(...)
      txQueue.push(createResolvedChain([{ id: 1, processId: 1 }]));

      const result = await processService.create(input, 1);

      expect(mockDb.transaction).toHaveBeenCalledOnce();
      expect(mockTx.insert).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockProcess);
    });

    it('should call auditService.log after creation', async () => {
      const input = {
        processCode: 'IMP-2024-002',
        brand: 'puket' as const,
      };
      const mockProcess = { id: 2, processCode: 'IMP-2024-002', status: 'draft' };

      txQueue.push(createResolvedChain([mockProcess]));
      txQueue.push(createResolvedChain([{ id: 1 }]));

      await processService.create(input as any, 5);

      expect(auditService.log).toHaveBeenCalledWith(
        5,
        'create',
        'process',
        2,
        { processCode: 'IMP-2024-002' },
        null,
      );
    });
  });

  describe('getById()', () => {
    it('should return process with documents and followUp', async () => {
      const mockProcess = { id: 1, processCode: 'IMP-001', status: 'draft' };
      const mockDocs = [{ id: 10, processId: 1, type: 'invoice' }];
      const mockFollowUp = { id: 5, processId: 1 };

      // db.select().from(importProcesses).where(...).limit(1) -> [mockProcess]
      queryQueue.push(createResolvedChain([mockProcess]));
      // db.select().from(documents).where(...) -> mockDocs
      queryQueue.push(createResolvedChain(mockDocs));
      // db.select().from(followUpTracking).where(...).limit(1) -> [mockFollowUp]
      queryQueue.push(createResolvedChain([mockFollowUp]));

      const result = await processService.getById(1);

      expect(result).toEqual({
        ...mockProcess,
        documents: mockDocs,
        followUp: mockFollowUp,
      });
    });

    it('should throw NotFoundError when process does not exist', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(processService.getById(999)).rejects.toThrow('nao encontrado');
    });
  });

  describe('updateStatus()', () => {
    it('should validate state transition before updating', async () => {
      const mockProcess = { id: 1, status: 'draft' };
      const updatedProcess = { id: 1, status: 'documents_received' };

      // select current process
      queryQueue.push(createResolvedChain([mockProcess]));
      // update and return
      queryQueue.push(createResolvedChain([updatedProcess]));

      const result = await processService.updateStatus(1, 'documents_received', 1);

      expect(result).toEqual(updatedProcess);
      expect(auditService.log).toHaveBeenCalledWith(
        1,
        'status_update',
        'process',
        1,
        { status: 'documents_received' },
        null,
      );
    });

    it('should throw InvalidTransitionError for invalid transitions (e.g. completed -> draft)', async () => {
      const mockProcess = { id: 1, status: 'completed' };

      queryQueue.push(createResolvedChain([mockProcess]));

      await expect(
        processService.updateStatus(1, 'draft', 1),
      ).rejects.toThrow('Transicao invalida');
    });
  });

  describe('update()', () => {
    it('should update fields and log audit', async () => {
      const updatedProcess = { id: 1, processCode: 'IMP-001', notes: 'updated' };

      queryQueue.push(createResolvedChain([updatedProcess]));

      const result = await processService.update(1, { notes: 'updated' } as any, 3);

      expect(result).toEqual(updatedProcess);
      expect(auditService.log).toHaveBeenCalledWith(
        3,
        'update',
        'process',
        1,
        { fields: ['notes'] },
        null,
      );
    });
  });

  describe('delete()', () => {
    it('should set status to cancelled', async () => {
      const mockProcess = { id: 1, status: 'draft' };
      const cancelledProcess = { id: 1 };

      // select current
      queryQueue.push(createResolvedChain([mockProcess]));
      // update returning
      queryQueue.push(createResolvedChain([cancelledProcess]));

      const result = await processService.delete(1, 2);

      expect(result).toEqual(cancelledProcess);
      expect(auditService.log).toHaveBeenCalledWith(
        2,
        'delete',
        'process',
        1,
        null,
        null,
      );
    });
  });
});
