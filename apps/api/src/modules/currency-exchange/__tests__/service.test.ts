import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { currencyExchangeService } = await import('../service.js');

describe('currencyExchangeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('list()', () => {
    it('should return exchanges for a process', async () => {
      const mockExchanges = [
        { id: 1, processId: 1, type: 'deposit', amountUsd: '5000.00' },
        { id: 2, processId: 1, type: 'balance', amountUsd: '15000.00' },
      ];

      queryQueue.push(createResolvedChain(mockExchanges));

      const result = await currencyExchangeService.list(1);

      expect(result).toEqual(mockExchanges);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no exchanges exist', async () => {
      queryQueue.push(createResolvedChain([]));

      const result = await currencyExchangeService.list(999);

      expect(result).toEqual([]);
    });
  });

  describe('create()', () => {
    it('should create exchange record', async () => {
      const input = {
        processId: 1,
        type: 'deposit' as const,
        amountUsd: '5000.00',
        exchangeRate: '5.20',
        notes: 'Test deposit',
      };

      const mockExchange = { id: 1, ...input, amountBrl: '26000.00' };

      queryQueue.push(createResolvedChain([mockExchange]));

      const result = await currencyExchangeService.create(input);

      expect(result).toEqual(mockExchange);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should calculate amountBrl from amountUsd and exchangeRate', async () => {
      const input = {
        processId: 1,
        type: 'balance' as const,
        amountUsd: '10000.00',
        exchangeRate: '5.50',
      };

      const mockExchange = { id: 2, ...input, amountBrl: '55000.00' };
      queryQueue.push(createResolvedChain([mockExchange]));

      const result = await currencyExchangeService.create(input);

      expect(result).toEqual(mockExchange);
    });
  });

  describe('update()', () => {
    it('should update exchange and return updated record', async () => {
      const existing = { id: 1, amountUsd: '5000.00', exchangeRate: '5.20', amountBrl: '26000.00' };
      const updated = { id: 1, amountUsd: '5000.00', exchangeRate: '5.50', amountBrl: '27500.00' };

      // select existing
      queryQueue.push(createResolvedChain([existing]));
      // update returning
      queryQueue.push(createResolvedChain([updated]));

      const result = await currencyExchangeService.update(1, { exchangeRate: '5.50' });

      expect(result).toEqual(updated);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw if exchange not found', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(currencyExchangeService.update(999, { exchangeRate: '5.50' })).rejects.toThrow(
        'não encontrado',
      );
    });
  });

  describe('delete()', () => {
    it('should remove exchange and return id', async () => {
      const mockExchange = { id: 1 };

      queryQueue.push(createResolvedChain([mockExchange]));

      const result = await currencyExchangeService.delete(1);

      expect(result).toEqual({ id: 1 });
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw if exchange not found', async () => {
      queryQueue.push(createResolvedChain([]));

      await expect(currencyExchangeService.delete(999)).rejects.toThrow('não encontrado');
    });
  });
});
