import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/state-machine/process-states.js', () => ({
  assertTransition: vi.fn(),
}));

vi.mock('../templates/puket.template.js', () => ({
  generatePuketSheet: vi.fn().mockReturnValue({}),
}));

vi.mock('../templates/imaginarium.template.js', () => ({
  generateImaginariumSheet: vi.fn().mockReturnValue({}),
}));

vi.mock('xlsx', () => ({
  utils: {
    book_new: vi.fn().mockReturnValue({}),
    book_append_sheet: vi.fn(),
  },
  write: vi.fn().mockReturnValue(Buffer.from('xlsx data')),
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('xlsx data')),
  },
}));

vi.mock('../../integrations/google-sheets.service.js', () => ({
  googleSheetsService: { syncMilestone: vi.fn().mockResolvedValue(undefined) },
}));

const { espelhoService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');

describe('espelhoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('generate()', () => {
    it('should throw NotFoundError when process does not exist', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(espelhoService.generate(999)).rejects.toThrow('nao encontrado');
    });

    it('should create espelho with correct version', async () => {
      const mockProcess = { id: 1, processCode: 'IMP-001', brand: 'puket', status: 'validated' };
      const mockItems = [
        { id: 1, processId: 1, itemCode: 'A001', description: 'Test', requiresLi: false },
      ];
      const mockEspelho = { id: 10, processId: 1, version: 2, brand: 'puket' };

      // select process
      queryQueue.push(createResolvedChain([mockProcess]));
      // select items
      queryQueue.push(createResolvedChain(mockItems));
      // select existing espelhos (for version calc)
      queryQueue.push(createResolvedChain([{ version: 1 }]));
      // insert espelho
      queryQueue.push(createResolvedChain([mockEspelho]));
      // update process status
      queryQueue.push(createResolvedChain(undefined));
      // update followUpTracking
      queryQueue.push(createResolvedChain(undefined));

      const result = await espelhoService.generate(1, 1);

      expect(result).toEqual(mockEspelho);
      expect(result.version).toBe(2);
      expect(auditService.log).toHaveBeenCalledWith(
        1,
        'generate',
        'espelho',
        10,
        expect.objectContaining({ processId: 1, version: 2 }),
        null,
      );
    });

    it('should update process status to espelho_generated', async () => {
      const mockProcess = { id: 1, processCode: 'IMP-001', brand: 'puket', status: 'validated' };
      const mockItems = [{ id: 1, processId: 1, itemCode: 'A001' }];
      const mockEspelho = { id: 10, processId: 1, version: 1, brand: 'puket' };

      queryQueue.push(createResolvedChain([mockProcess])); // select process
      queryQueue.push(createResolvedChain(mockItems));      // select items
      queryQueue.push(createResolvedChain([]));             // no existing espelhos
      queryQueue.push(createResolvedChain([mockEspelho]));  // insert espelho
      queryQueue.push(createResolvedChain(undefined));      // update process
      queryQueue.push(createResolvedChain(undefined));      // update followUp

      await espelhoService.generate(1, 1);

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('getItems()', () => {
    it('should return items for a process', async () => {
      const mockItems = [
        { id: 1, processId: 1, itemCode: 'A001' },
        { id: 2, processId: 1, itemCode: 'A002' },
      ];

      queryQueue.push(createResolvedChain(mockItems));

      const result = await espelhoService.getItems(1);

      expect(result).toEqual(mockItems);
      expect(result).toHaveLength(2);
    });
  });
});
