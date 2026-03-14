import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../google-chat.service.js', () => ({
  sendToGoogleChat: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { alertService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');

describe('alertService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('create()', () => {
    it('should create alert with correct fields when no duplicate exists', async () => {
      const input = {
        processId: 1,
        severity: 'warning' as const,
        title: 'Test Alert',
        message: 'Something happened',
      };

      const mockAlert = { id: 1, ...input, acknowledged: false };

      // hasDuplicateRecent: select by processId+title -> no existing
      queryQueue.push(createResolvedChain([]));
      // insert alert returning
      queryQueue.push(createResolvedChain([mockAlert]));
      // select systemSettings for webhook
      queryQueue.push(createResolvedChain([]));

      const result = await alertService.create(input);

      expect(result).toEqual(mockAlert);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'alert_created',
        'alert',
        1,
        { severity: 'warning', title: 'Test Alert' },
        null,
      );
    });

    it('should return existing alert if duplicate found within 24h', async () => {
      const input = {
        processId: 1,
        severity: 'info' as const,
        title: 'Duplicate Alert',
        message: 'Dup message',
      };

      const existingAlert = { id: 5, ...input, acknowledged: false };

      // hasDuplicateRecent: select -> found existing
      queryQueue.push(createResolvedChain([{ id: 5 }]));
      // select the existing duplicate
      queryQueue.push(createResolvedChain([existingAlert]));

      const result = await alertService.create(input);

      expect(result).toEqual(existingAlert);
      // Should NOT have called insert
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should skip duplicate check when processId is undefined', async () => {
      const input = {
        severity: 'critical' as const,
        title: 'System Alert',
        message: 'No process',
      };

      const mockAlert = { id: 2, ...input, acknowledged: false };

      // hasDuplicateRecent returns false (no processId) — no query needed
      // insert alert returning
      queryQueue.push(createResolvedChain([mockAlert]));
      // select systemSettings for webhook
      queryQueue.push(createResolvedChain([]));

      const result = await alertService.create(input);

      expect(result).toEqual(mockAlert);
    });
  });

  describe('list()', () => {
    it('should return paginated alerts with no filters', async () => {
      const mockAlerts = [
        { id: 1, title: 'Alert 1' },
        { id: 2, title: 'Alert 2' },
      ];

      // data query
      queryQueue.push(createResolvedChain(mockAlerts));
      // count query
      queryQueue.push(createResolvedChain([{ total: 2 }]));

      const result = await alertService.list();

      expect(result.data).toEqual(mockAlerts);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should apply processId filter', async () => {
      queryQueue.push(createResolvedChain([{ id: 1 }]));
      queryQueue.push(createResolvedChain([{ total: 1 }]));

      const result = await alertService.list({ processId: 5 });

      expect(result.data).toHaveLength(1);
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('should apply severity and acknowledged filters', async () => {
      queryQueue.push(createResolvedChain([]));
      queryQueue.push(createResolvedChain([{ total: 0 }]));

      const result = await alertService.list({ severity: 'critical', acknowledged: false });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('acknowledge()', () => {
    it('should set acknowledged=true and log audit', async () => {
      const mockAlert = { id: 1, acknowledged: true, acknowledgedBy: 3 };

      // update returning
      queryQueue.push(createResolvedChain([mockAlert]));

      const result = await alertService.acknowledge(1, 3);

      expect(result).toEqual(mockAlert);
      expect(mockDb.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(3, 'acknowledge', 'alert', 1, null, null);
    });

    it('should throw NotFoundError if alert does not exist', async () => {
      // update returning empty
      queryQueue.push(createResolvedChain([]));

      await expect(alertService.acknowledge(999, 1)).rejects.toThrow('não encontrado');
    });
  });
});
