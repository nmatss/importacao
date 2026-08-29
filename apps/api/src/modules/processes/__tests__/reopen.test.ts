import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../../shared/utils/process-events.js', () => ({
  recordProcessEvent: vi.fn(),
}));

const { processService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');
const { recordProcessEvent } = await import('../../../shared/utils/process-events.js');

/** Enfileira o SELECT do assertNotLocked + o SELECT do processo atual. */
function queueCurrent(status: string) {
  queryQueue.push(createResolvedChain([])); // assertNotLocked (nao travado)
  queryQueue.push(createResolvedChain([{ id: 1, status }]));
}

const MOTIVO = 'OHBL corrigido recebido do agente apos o envio a Fenicia';

describe('reabertura de processo (transicoes de volta)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('updateStatus() — sent_to_fenicia -> validating', () => {
    it('admin com motivo: revalida, grava o evento com status anterior, motivo e autoria', async () => {
      queueCurrent('sent_to_fenicia');
      queryQueue.push(createResolvedChain([{ id: 1, status: 'validating' }]));

      const result = await processService.updateStatus(1, 'validating', 7, {
        reason: MOTIVO,
        actorRole: 'admin',
      });

      expect(result).toEqual({ id: 1, status: 'validating' });
      expect(recordProcessEvent).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          eventType: 'status_changed',
          description: MOTIVO,
          metadata: {
            previousStatus: 'sent_to_fenicia',
            newStatus: 'validating',
            reopen: true,
            reason: MOTIVO,
          },
        }),
        7, // autoria
      );
      expect(auditService.log).toHaveBeenCalledWith(
        7,
        'status_reopen',
        'process',
        1,
        { status: 'validating', previousStatus: 'sent_to_fenicia', reason: MOTIVO },
        null,
      );
    });

    it('sem motivo: 400 e nao escreve nada', async () => {
      queueCurrent('sent_to_fenicia');

      await expect(
        processService.updateStatus(1, 'validating', 7, { actorRole: 'admin' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(recordProcessEvent).not.toHaveBeenCalled();
    });

    it('motivo curto demais: 400', async () => {
      queueCurrent('sent_to_fenicia');

      await expect(
        processService.updateStatus(1, 'validating', 7, { reason: 'ok', actorRole: 'admin' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('nao-admin com motivo valido: 403', async () => {
      queueCurrent('sent_to_fenicia');

      await expect(
        processService.updateStatus(1, 'validating', 7, { reason: MOTIVO, actorRole: 'operador' }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(recordProcessEvent).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus() — completed -> validating', () => {
    it('admin com motivo reabre o processo concluido', async () => {
      queueCurrent('completed');
      queryQueue.push(createResolvedChain([{ id: 1, status: 'validating' }]));

      await processService.updateStatus(1, 'validating', 7, {
        reason: MOTIVO,
        actorRole: 'admin',
      });

      expect(recordProcessEvent).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          metadata: expect.objectContaining({
            previousStatus: 'completed',
            newStatus: 'validating',
            reopen: true,
          }),
        }),
        7,
      );
    });

    it('continua bloqueando saidas que nao sao reabertura (completed -> draft)', async () => {
      queueCurrent('completed');

      await expect(
        processService.updateStatus(1, 'draft', 7, { reason: MOTIVO, actorRole: 'admin' }),
      ).rejects.toThrow('Transicao invalida');
    });
  });

  describe('updateStatus() — avanco normal', () => {
    it('nao exige motivo nem admin em validated -> validating', async () => {
      queueCurrent('validated');
      queryQueue.push(createResolvedChain([{ id: 1, status: 'validating' }]));

      await processService.updateStatus(1, 'validating', 7, { actorRole: 'operador' });

      expect(auditService.log).toHaveBeenCalledWith(
        7,
        'status_update',
        'process',
        1,
        { status: 'validating' },
        null,
      );
    });

    it('nao exige motivo nem admin em draft -> documents_received', async () => {
      queueCurrent('draft');
      queryQueue.push(createResolvedChain([{ id: 1, status: 'documents_received' }]));

      await expect(
        processService.updateStatus(1, 'documents_received', 7, { actorRole: 'operador' }),
      ).resolves.toBeDefined();
    });
  });

  describe('delete() — cancelamento', () => {
    it('cancela processo concluido quando ha motivo e admin', async () => {
      queueCurrent('completed');
      queryQueue.push(createResolvedChain([{ id: 1 }]));

      await processService.delete(1, 7, { reason: MOTIVO, actorRole: 'admin' });

      expect(auditService.log).toHaveBeenCalledWith(
        7,
        'delete',
        'process',
        1,
        { previousStatus: 'completed', reason: MOTIVO },
        null,
      );
      expect(recordProcessEvent).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          eventType: 'status_changed',
          metadata: expect.objectContaining({
            previousStatus: 'completed',
            newStatus: 'cancelled',
            reopen: true,
            reason: MOTIVO,
          }),
        }),
        7,
      );
    });

    it('recusa cancelar processo concluido sem motivo', async () => {
      queueCurrent('completed');

      await expect(processService.delete(1, 7, { actorRole: 'admin' })).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('cancelamento de processo em andamento segue sem exigir motivo', async () => {
      queueCurrent('validating');
      queryQueue.push(createResolvedChain([{ id: 1 }]));

      await processService.delete(1, 7, { actorRole: 'operador' });

      expect(auditService.log).toHaveBeenCalledWith(7, 'delete', 'process', 1, null, null);
      // O cancelamento comum tambem passou a deixar rastro na timeline.
      expect(recordProcessEvent).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          eventType: 'status_changed',
          metadata: { previousStatus: 'validating', newStatus: 'cancelled' },
        }),
        7,
      );
    });
  });
});
