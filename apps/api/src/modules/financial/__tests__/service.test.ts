import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../currency-exchange/service.js', () => ({
  currencyExchangeService: { list: vi.fn() },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { financialService } = await import('../service.js');
const { currencyExchangeService } = await import('../../currency-exchange/service.js');
const { auditService } = await import('../../audit/service.js');

const baseProcess = {
  id: 7,
  processCode: 'IM0712602NB',
  totalFobValue: '100000.00',
  freightValue: '5000.00',
  insuranceValue: '500.00',
  freeTimeDays: 14,
  eta: '2026-06-01',
  etaActual: null,
};

describe('financialService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('getSnapshot()', () => {
    it('lança NotFound quando o processo não existe', async () => {
      queryQueue.push(createResolvedChain([]));
      await expect(financialService.getSnapshot(99)).rejects.toThrow('Processo não encontrado');
    });

    it('usa a taxa do câmbio mais recente com exchangeRate preenchido', async () => {
      queryQueue.push(createResolvedChain([baseProcess]));
      vi.mocked(currencyExchangeService.list).mockResolvedValue([
        { exchangeRate: null },
        { exchangeRate: '5.200000' },
      ] as never);

      const snapshot = await financialService.getSnapshot(7);

      expect(snapshot.exchangeRate).toBe(5.2);
      expect(snapshot.currency).toBe('BRL');
      expect(snapshot.customsValueUsd).toBe(105_500);
      expect(snapshot.customsValueBrl).toBe(548_600);
      expect(snapshot.numerario).toEqual({ numerarioValue: 329_160, numerarioPct: 0.6 });
    });

    it('sem câmbio registrado retorna snapshot em USD com flag', async () => {
      queryQueue.push(createResolvedChain([baseProcess]));
      vi.mocked(currencyExchangeService.list).mockResolvedValue([] as never);

      const snapshot = await financialService.getSnapshot(7);

      expect(snapshot.currency).toBe('USD');
      expect(snapshot.customsValueBrl).toBeNull();
      expect(snapshot.numerario).toBeNull();
      expect(snapshot.missing).toContain('exchangeRate');
    });
  });

  describe('recompute()', () => {
    it('persiste numerário quando há taxa USD', async () => {
      queryQueue.push(createResolvedChain([baseProcess]));
      const updateChain = createResolvedChain([]);
      queryQueue.push(updateChain);
      vi.mocked(currencyExchangeService.list).mockResolvedValue([
        { exchangeRate: '5.200000' },
      ] as never);

      const result = await financialService.recompute(7, 42);

      expect(result.persisted).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          numerarioValue: '329160.00',
          numerarioPct: '0.6000',
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        42,
        'financial_recompute',
        'process',
        7,
        expect.objectContaining({ persisted: true }),
        null,
      );
    });

    it('NÃO persiste quando falta taxa USD (evita BRL errado)', async () => {
      queryQueue.push(createResolvedChain([baseProcess]));
      vi.mocked(currencyExchangeService.list).mockResolvedValue([] as never);

      const result = await financialService.recompute(7, 42);

      expect(result.persisted).toBe(false);
      expect((result as { reason?: string }).reason).toBe('missing_exchange_rate');
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        42,
        'financial_recompute',
        'process',
        7,
        expect.objectContaining({ persisted: false, reason: 'missing_exchange_rate' }),
        null,
      );
    });
  });
});
