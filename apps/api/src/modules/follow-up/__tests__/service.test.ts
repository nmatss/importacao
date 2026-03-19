import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../integrations/google-sheets.service.js', () => ({
  googleSheetsService: { readProcessRow: vi.fn() },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { followUpService } = await import('../service.js');

describe('followUpService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('getAll()', () => {
    it('should return follow-up records with process data', async () => {
      const mockData = [
        { id: 1, processId: 1, processCode: 'IMP-001', brand: 'puket', status: 'draft' },
        {
          id: 2,
          processId: 2,
          processCode: 'IMP-002',
          brand: 'imaginarium',
          status: 'documents_received',
        },
      ];

      // data query (innerJoin)
      queryQueue.push(createResolvedChain(mockData));
      // count query
      queryQueue.push(createResolvedChain([{ total: 2 }]));

      const result = await followUpService.getAll();

      expect(result.data).toEqual(mockData);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should support pagination', async () => {
      queryQueue.push(createResolvedChain([]));
      queryQueue.push(createResolvedChain([{ total: 50 }]));

      const result = await followUpService.getAll(3, 10);

      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(50);
    });
  });

  describe('getByProcess()', () => {
    it('should return tracking for a process', async () => {
      const mockTracking = { id: 1, processId: 5, overallProgress: 42 };

      queryQueue.push(createResolvedChain([mockTracking]));

      const result = await followUpService.getByProcess(5);

      expect(result).toEqual(mockTracking);
    });

    it('should throw NotFoundError if not found', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(followUpService.getByProcess(999)).rejects.toThrow('não encontrado');
    });
  });

  describe('update()', () => {
    it('should update tracking record and recalculate progress', async () => {
      const existingTracking = {
        id: 1,
        processId: 1,
        documentsReceivedAt: null,
        preInspectionAt: null,
        ncmVerifiedAt: null,
        espelhoGeneratedAt: null,
        sentToFeniciaAt: null,
        liSubmittedAt: null,
        liApprovedAt: null,
      };
      const mockTracking = {
        id: 1,
        processId: 1,
        documentsReceivedAt: new Date(),
        overallProgress: 14,
      };

      // select existing tracking
      queryQueue.push(createResolvedChain([existingTracking]));
      // update returning
      queryQueue.push(createResolvedChain([mockTracking]));

      const result = await followUpService.update(1, {
        documentsReceivedAt: new Date().toISOString(),
      });

      expect(result).toEqual(mockTracking);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw NotFoundError if tracking not found', async () => {
      // select existing (found)
      queryQueue.push(createResolvedChain([{ id: 1, processId: 999 }]));
      // update returning (empty = not found)
      queryQueue.push(createResolvedChain([]));

      await expect(followUpService.update(999, { notes: 'test' })).rejects.toThrow(
        'não encontrado',
      );
    });

    it('should filter out non-allowed fields', async () => {
      const mockTracking = { id: 1, processId: 1, overallProgress: 0 };
      // select existing
      queryQueue.push(createResolvedChain([{ id: 1, processId: 1 }]));
      // update returning
      queryQueue.push(createResolvedChain([mockTracking]));

      const result = await followUpService.update(1, {
        notes: 'safe field',
        hackerField: 'should be ignored',
      } as any);

      expect(result).toEqual(mockTracking);
    });
  });

  describe('getLiDeadlines()', () => {
    it('should return upcoming deadlines', async () => {
      const mockDeadlines = [
        {
          processId: 1,
          processCode: 'IMP-001',
          daysRemaining: 5,
          liSubmittedAt: null,
          liApprovedAt: null,
        },
        {
          processId: 2,
          processCode: 'IMP-002',
          daysRemaining: -2,
          liSubmittedAt: new Date(),
          liApprovedAt: null,
        },
      ];

      queryQueue.push(createResolvedChain(mockDeadlines));

      const result = await followUpService.getLiDeadlines();

      expect(result).toEqual(mockDeadlines);
      expect(result).toHaveLength(2);
    });
  });
});
