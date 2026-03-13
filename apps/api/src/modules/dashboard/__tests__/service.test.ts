import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

const { dashboardService } = await import('../service.js');

describe('dashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('getOverview()', () => {
    it('should run all 6 queries in parallel', async () => {
      const mockAlerts = [{ id: 1, title: 'Alert 1' }];
      const mockProcesses = [{ id: 1, processCode: 'IMP-001' }];

      // 6 parallel queries in Promise.all
      queryQueue.push(createResolvedChain([{ count: 5 }]));        // active count
      queryQueue.push(createResolvedChain([{ count: 3 }]));        // completed count
      queryQueue.push(createResolvedChain([{ total: '50000' }]));  // fob total
      queryQueue.push(createResolvedChain([{ count: 1 }]));        // overdue count
      queryQueue.push(createResolvedChain(mockAlerts));             // recent alerts
      queryQueue.push(createResolvedChain(mockProcesses));          // recent processes

      const result = await dashboardService.getOverview();

      expect(result).toHaveProperty('activeProcesses');
      expect(result).toHaveProperty('overdueProcesses');
      expect(result).toHaveProperty('completedThisMonth');
      expect(result).toHaveProperty('totalFobValue');
      expect(result).toHaveProperty('recentAlerts');
      expect(result).toHaveProperty('recentProcesses');
      expect(result.activeProcesses).toBe(5);
      expect(result.completedThisMonth).toBe(3);
      expect(result.totalFobValue).toBe('50000');
      expect(result.recentAlerts).toEqual(mockAlerts);
    });
  });

  describe('getSla()', () => {
    it('should return all 8 SLA categories', async () => {
      // 8 parallel queries
      queryQueue.push(createResolvedChain([{ id: 1, processCode: 'IMP-001' }])); // docsOverdue
      queryQueue.push(createResolvedChain([]));   // liUrgent
      queryQueue.push(createResolvedChain([]));   // withDivergences
      queryQueue.push(createResolvedChain([]));   // pendingFenicia
      queryQueue.push(createResolvedChain([]));   // noEspelho
      queryQueue.push(createResolvedChain([]));   // noFollowUpUpdate
      queryQueue.push(createResolvedChain([]));   // agingByUser
      queryQueue.push(createResolvedChain([]));   // upcomingPayments

      const result = await dashboardService.getSla();

      expect(result).toHaveProperty('docsOverdue');
      expect(result).toHaveProperty('liUrgent');
      expect(result).toHaveProperty('withDivergences');
      expect(result).toHaveProperty('pendingFenicia');
      expect(result).toHaveProperty('noEspelho');
      expect(result).toHaveProperty('noFollowUpUpdate');
      expect(result).toHaveProperty('agingByUser');
      expect(result).toHaveProperty('upcomingPayments');
      expect(result).toHaveProperty('summary');
      expect(result.summary.docsOverdue).toBe(1);
    });
  });

  describe('getByStatus()', () => {
    it('should return process counts grouped by status', async () => {
      const mockStatusCounts = [
        { status: 'draft', count: 5 },
        { status: 'documents_received', count: 3 },
        { status: 'validated', count: 2 },
        { status: 'completed', count: 10 },
      ];

      queryQueue.push(createResolvedChain(mockStatusCounts));

      const result = await dashboardService.getByStatus();

      expect(result).toEqual(mockStatusCounts);
      expect(result).toHaveLength(4);
    });
  });
});
