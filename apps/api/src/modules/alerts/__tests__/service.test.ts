import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { dateRangeBounds } from '../../../__tests__/helpers/sql-inspect.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../google-chat.service.js', () => ({
  sendToGoogleChat: vi.fn().mockResolvedValue(false),
  isChatCooldownActive: vi.fn(() => false),
}));

vi.mock('../../../shared/metrics/index.js', () => ({
  alertDeliveryTotal: { inc: vi.fn() },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { alertService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');
const { sendToGoogleChat } = await import('../google-chat.service.js');

const WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';

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

    it('dedupes by title alone when processId is undefined (no duplicate found)', async () => {
      const input = {
        severity: 'critical' as const,
        title: 'System Alert',
        message: 'No process',
      };

      const mockAlert = { id: 2, ...input, acknowledged: false };

      // hasDuplicateRecent select (processId IS NULL + title) — no duplicate
      queryQueue.push(createResolvedChain([]));
      // insert alert returning
      queryQueue.push(createResolvedChain([mockAlert]));
      // select systemSettings for webhook
      queryQueue.push(createResolvedChain([]));

      const result = await alertService.create(input);

      expect(result).toEqual(mockAlert);
    });

    it('collapses a recurring cron alert (no processId, same title) into the existing one', async () => {
      const input = {
        severity: 'critical' as const,
        title: 'Falha no job: logistic-sync',
        message: 'Job falhou de novo',
      };

      const existing = { id: 9, ...input, acknowledged: false };

      // hasDuplicateRecent select -> a recent row with NULL processId + same title exists
      queryQueue.push(createResolvedChain([{ id: 9 }]));
      // create() then re-selects and returns the existing alert (no insert)
      queryQueue.push(createResolvedChain([existing]));

      const result = await alertService.create(input);

      expect(result).toEqual(existing);
      // no new row inserted — the storm is collapsed
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    /**
     * O defeito que produziu `Falha no job: sydle-sync` criado todo dia de
     * 08/08 a 13/08 sem NUNCA ser entregue: a deduplicacao devolvia o registro
     * existente antes de tentar entregar, entao uma falha na primeira tentativa
     * da janela bloqueava todas as seguintes.
     */
    it('duplicado ainda NAO entregue: tenta a entrega antes de devolver', async () => {
      const existing = {
        id: 9,
        processId: null,
        severity: 'critical' as const,
        title: 'Falha no job: sydle-sync',
        message: 'falhou de novo',
        sentToChat: false,
        deliveryAttempts: 1,
      };

      // hasDuplicateRecent -> encontrou
      queryQueue.push(createResolvedChain([{ id: 9 }]));
      // select do duplicado
      queryQueue.push(createResolvedChain([existing]));
      // resolucao do webhook
      queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));
      // update do estado da entrega
      queryQueue.push(createResolvedChain([]));

      const result = await alertService.create({
        severity: 'critical',
        title: 'Falha no job: sydle-sync',
        message: 'falhou de novo',
      });

      expect(result).toEqual(existing);
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(sendToGoogleChat).toHaveBeenCalledWith(WEBHOOK, expect.objectContaining({ id: 9 }));
    });

    it('duplicado JA entregue: nao reenvia', async () => {
      const existing = {
        id: 10,
        processId: null,
        severity: 'critical' as const,
        title: 'Falha no job: sydle-sync',
        message: 'falhou de novo',
        sentToChat: true,
        deliveryAttempts: 1,
      };

      queryQueue.push(createResolvedChain([{ id: 10 }]));
      queryQueue.push(createResolvedChain([existing]));

      const result = await alertService.create({
        severity: 'critical',
        title: 'Falha no job: sydle-sync',
        message: 'falhou de novo',
      });

      expect(result).toEqual(existing);
      expect(sendToGoogleChat).not.toHaveBeenCalled();
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

describe('alertService.list() — recorte por periodo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  it('cobre o dia local inteiro, com limite superior exclusivo', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await alertService.list({ startDate: '2026-08-29', endDate: '2026-08-29' });

    const where = mockDb.select.mock.results[0].value.where.mock.calls[0][0];
    const { start, end } = dateRangeBounds(where);
    // America/Sao_Paulo (UTC-3): meia-noite local = 03:00 UTC.
    expect(start!.toISOString()).toBe('2026-08-29T03:00:00.000Z');
    expect(end!.toISOString()).toBe('2026-08-30T03:00:00.000Z');

    const ultimoInstanteLocal = new Date('2026-08-29T23:59:59.999-03:00');
    const primeiroInstanteDoDiaSeguinte = new Date('2026-08-30T00:00:00.000-03:00');
    expect(ultimoInstanteLocal.getTime()).toBeGreaterThanOrEqual(start!.getTime());
    expect(ultimoInstanteLocal.getTime()).toBeLessThan(end!.getTime());
    expect(primeiroInstanteDoDiaSeguinte.getTime()).toBeGreaterThanOrEqual(end!.getTime());
  });

  it('ignora data invalida em vez de estourar', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await expect(alertService.list({ endDate: 'abc' })).resolves.toBeDefined();
    expect(mockDb.select.mock.results[0].value.where).toHaveBeenCalledWith(undefined);
  });
});
