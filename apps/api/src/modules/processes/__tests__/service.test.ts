import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { dateRangeBounds } from '../../../__tests__/helpers/sql-inspect.js';
import { desc } from 'drizzle-orm';
import { importProcesses } from '../../../shared/database/schema.js';

const { mockDb, mockTx, queryQueue, txQueue } = createMockDb();

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

  describe('Draft BL checklist', () => {
    it('rebuilds the shared state from the latest append-only event per item', async () => {
      queryQueue.push(createResolvedChain([{ id: 1 }]));
      queryQueue.push(
        createResolvedChain([
          {
            id: 3,
            metadata: {
              key: 'draftReceivedOk',
              checked: false,
              timestamp: '2026-08-28T12:00:00.000Z',
            },
            createdBy: 7,
            createdAt: new Date('2026-08-28T12:00:00.000Z'),
            userName: 'Operadora A',
          },
          {
            id: 2,
            metadata: {
              key: 'exporterOk',
              checked: true,
              timestamp: '2026-08-28T11:30:00.000Z',
            },
            createdBy: 8,
            createdAt: new Date('2026-08-28T11:30:00.000Z'),
            userName: 'Operadora B',
          },
          {
            id: 1,
            metadata: {
              key: 'draftReceivedOk',
              checked: true,
              timestamp: '2026-08-28T11:00:00.000Z',
            },
            createdBy: 7,
            createdAt: new Date('2026-08-28T11:00:00.000Z'),
            userName: 'Operadora A',
          },
        ]),
      );

      const result = await processService.getDraftBlChecklist(1);

      expect(result.draftReceivedOk).toEqual({
        checked: false,
        timestamp: null,
        checkedBy: null,
        checkedByName: null,
      });
      expect(result.exporterOk).toEqual({
        checked: true,
        timestamp: '2026-08-28T11:30:00.000Z',
        checkedBy: 8,
        checkedByName: 'Operadora B',
      });
      expect(result.containersOk.checked).toBe(false);
    });

    it('persists the acting user in both process history and the audit log', async () => {
      queryQueue.push(createResolvedChain([])); // assertNotLocked
      queryQueue.push(createResolvedChain([{ id: 1 }])); // process exists
      queryQueue.push(createResolvedChain([{ name: 'Operadora A' }]));
      const insertEvent = createResolvedChain([]);
      queryQueue.push(insertEvent);

      const result = await processService.updateDraftBlChecklist(
        1,
        { key: 'draftReceivedOk', checked: true },
        7,
      );

      expect(insertEvent.values).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 1,
          eventType: 'draft_bl_checklist_changed',
          createdBy: 7,
          metadata: expect.objectContaining({
            key: 'draftReceivedOk',
            checked: true,
            checkedByName: 'Operadora A',
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        7,
        'draft_bl_checklist_update',
        'process',
        1,
        { key: 'draftReceivedOk', checked: true },
        null,
      );
      expect(result).toMatchObject({
        key: 'draftReceivedOk',
        checked: true,
        checkedBy: 7,
        checkedByName: 'Operadora A',
      });
    });
  });

  describe('updateStatus()', () => {
    it('should validate state transition before updating', async () => {
      const mockProcess = { id: 1, status: 'draft' };
      const updatedProcess = { id: 1, status: 'documents_received' };

      // assertNotLocked select — empty (not locked)
      queryQueue.push(createResolvedChain([]));
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

      // assertNotLocked select
      queryQueue.push(createResolvedChain([]));
      queryQueue.push(createResolvedChain([mockProcess]));

      await expect(processService.updateStatus(1, 'draft', 1)).rejects.toThrow(
        'Transicao invalida',
      );
    });
  });

  describe('advanceLogisticStatus()', () => {
    it('uses ETD from espelho/BL summary when process columns are still empty', async () => {
      queryQueue.push(createResolvedChain([])); // assertNotLocked
      queryQueue.push(
        createResolvedChain([
          {
            id: 1,
            status: 'documents_received',
            logisticStatus: 'consolidation',
            etd: null,
            eta: null,
            shipmentDate: null,
            customsChannel: null,
            diNumber: null,
            customsClearanceAt: null,
            cdArrivalAt: null,
            aiExtractedData: { espelho: { summary: { etd: '2026-02-01' } } },
          },
        ]),
      );
      queryQueue.push(createResolvedChain([{ processId: 1 }])); // follow-up
      const updateChain = createResolvedChain([]);
      queryQueue.push(updateChain);

      const result = await processService.advanceLogisticStatus(1, 7);

      expect(result).toEqual({
        updated: true,
        previous: 'consolidation',
        current: 'in_transit',
      });
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ logisticStatus: 'in_transit' }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        7,
        'logistic_status_auto_advance',
        'process',
        1,
        { previousStatus: 'consolidation', newStatus: 'in_transit' },
        null,
      );
    });
  });

  describe('update()', () => {
    it('should update fields and log audit', async () => {
      const updatedProcess = { id: 1, processCode: 'IMP-001', notes: 'updated' };

      // assertNotLocked select
      queryQueue.push(createResolvedChain([]));
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

  describe('lock() / unlock() / rename()', () => {
    it('lock() sets lockedAt and returns updated process', async () => {
      const current = { id: 7, lockedAt: null };
      const locked = { id: 7, lockedAt: new Date(), lockedReason: 'vimbar_approval' };
      queryQueue.push(createResolvedChain([current])); // select current
      queryQueue.push(createResolvedChain([locked])); // update returning

      const result = await processService.lock(7, 'vimbar_approval', null);
      expect(result).toEqual(locked);
      expect(auditService.log).toHaveBeenCalledWith(
        null,
        'lock',
        'process',
        7,
        { reason: 'vimbar_approval' },
        null,
      );
    });

    it('lock() is idempotent when process is already locked', async () => {
      const current = { id: 7, lockedAt: new Date() };
      queryQueue.push(createResolvedChain([current]));

      const result = await processService.lock(7, 'manual', null);
      expect(result).toEqual(current);
    });

    it('assertNotLocked() throws 423 when process is locked', async () => {
      queryQueue.push(
        createResolvedChain([
          { lockedAt: new Date('2026-05-22'), lockedReason: 'vimbar_approval' },
        ]),
      );

      try {
        await processService.assertNotLocked(7);
        expect.fail('expected throw');
      } catch (err: any) {
        expect(err.statusCode).toBe(423);
        expect(err.message).toMatch(/travado/);
      }
    });

    it('rename() rejects with 409 when target code already exists (unique violation)', async () => {
      // assertNotLocked (not locked)
      queryQueue.push(createResolvedChain([]));
      // tx SELECT current
      txQueue.push(createResolvedChain([{ id: 1, processCode: 'IM001', previousCodes: [] }]));
      // tx UPDATE throws unique violation
      const failChain = createResolvedChain([]);
      const original = failChain.then.bind(failChain);
      failChain.then = function (onFulfilled: any, onRejected?: any) {
        const err: any = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        return Promise.reject(err).then(onFulfilled, onRejected);
      };
      // Restore the original then for chained calls before .returning(); we
      // only want the final await to reject. Use a wrapper that delays:
      void original;
      txQueue.push(failChain);

      try {
        await processService.rename(1, 'IM002', 'precons_change', null);
        expect.fail('expected throw');
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
      }
    });

    it('rename() appends to previousCodes and audit-logs', async () => {
      const current = { id: 1, processCode: 'IM001', previousCodes: [] };
      const renamed = { id: 1, processCode: 'IM002', previousCodes: ['IM001'] };
      queryQueue.push(createResolvedChain([])); // assertNotLocked
      txQueue.push(createResolvedChain([current])); // tx select current
      txQueue.push(createResolvedChain([renamed])); // tx update returning

      const result = await processService.rename(1, 'IM002', 'precons_change', 9);
      expect(result).toEqual(renamed);
      expect(auditService.log).toHaveBeenCalledWith(
        9,
        'rename',
        'process',
        1,
        { from: 'IM001', to: 'IM002', reason: 'precons_change' },
        null,
      );
    });

    it('rename() is a no-op (returns current) when only case differs', async () => {
      const current = { id: 1, processCode: 'IM001', previousCodes: [] };
      queryQueue.push(createResolvedChain([])); // assertNotLocked
      txQueue.push(createResolvedChain([current])); // tx select current

      const result = await processService.rename(1, 'im001', undefined, null);
      expect(result).toEqual(current);
    });
  });

  describe('delete()', () => {
    it('should set status to cancelled', async () => {
      const mockProcess = { id: 1, status: 'draft' };
      const cancelledProcess = { id: 1 };

      // assertNotLocked select
      queryQueue.push(createResolvedChain([]));
      // select current
      queryQueue.push(createResolvedChain([mockProcess]));
      // update returning
      queryQueue.push(createResolvedChain([cancelledProcess]));

      const result = await processService.delete(1, 2);

      expect(result).toEqual(cancelledProcess);
      expect(auditService.log).toHaveBeenCalledWith(2, 'delete', 'process', 1, null, null);
    });
  });
});

describe('processService.list()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  const filtroBase = { page: 1, limit: 20 } as any;

  it('cobre o dia local inteiro, com limite superior exclusivo', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await processService.list({ ...filtroBase, startDate: '2026-08-29', endDate: '2026-08-29' });

    const where = mockDb.select.mock.results[0].value.where.mock.calls[0][0];
    const { start, end } = dateRangeBounds(where);
    // America/Sao_Paulo (UTC-3): meia-noite local = 03:00 UTC. Tratar a data
    // como meia-noite UTC deixava as tres ultimas horas do dia de fora.
    expect(start!.toISOString()).toBe('2026-08-29T03:00:00.000Z');
    expect(end!.toISOString()).toBe('2026-08-30T03:00:00.000Z');

    const ultimoInstanteLocal = new Date('2026-08-29T23:59:59.999-03:00');
    const primeiroInstanteDoDiaSeguinte = new Date('2026-08-30T00:00:00.000-03:00');
    expect(ultimoInstanteLocal.getTime()).toBeGreaterThanOrEqual(start!.getTime());
    expect(ultimoInstanteLocal.getTime()).toBeLessThan(end!.getTime());
    expect(primeiroInstanteDoDiaSeguinte.getTime()).toBeGreaterThanOrEqual(end!.getTime());
  });

  it('mantem o filtro de busca intacto ao lado do recorte por periodo', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await processService.list({
      ...filtroBase,
      search: 'PK2052602TJ',
      startDate: '2026-08-29',
      endDate: '2026-08-29',
    });

    const where = mockDb.select.mock.results[0].value.where.mock.calls[0][0];
    const { start, end } = dateRangeBounds(where);
    expect(start!.toISOString()).toBe('2026-08-29T03:00:00.000Z');
    expect(end!.toISOString()).toBe('2026-08-30T03:00:00.000Z');
  });

  it('ignora data invalida em vez de estourar "Invalid time value"', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await expect(processService.list({ ...filtroBase, endDate: 'abc' })).resolves.toBeDefined();
    expect(mockDb.select.mock.results[0].value.where).toHaveBeenCalledWith(undefined);
  });

  it('pagina com desempate estavel por id', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await processService.list({ ...filtroBase, page: 2 });

    // Os 117 processos importados da planilha tem createdAt praticamente
    // identico: sem desempate, linhas repetem ou somem entre paginas.
    expect(mockDb.select.mock.results[0].value.orderBy).toHaveBeenCalledWith(
      desc(importProcesses.createdAt),
      desc(importProcesses.id),
    );
  });
});

describe('processService.update() — limpar campo com null', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  // Contrato: chave com `null` apaga o valor; chave ausente nao mexe. O
  // `mapUpdateSet` do Drizzle filtra `undefined` do SET e mantem `null`, entao
  // o que importa e o que chega em `.set()`.

  it('leva o null ate o SET e a leitura seguinte devolve null', async () => {
    // assertNotLocked
    queryQueue.push(createResolvedChain([{ lockedAt: null, lockedReason: null }]));
    // update ... returning
    queryQueue.push(createResolvedChain([{ id: 1, etd: null, notes: null }]));
    // advanceLogisticStatus (etd e campo logistico): getById do processo
    queryQueue.push(createResolvedChain([]));

    const result = await processService.update(1, { etd: null, notes: null } as any, 7);

    const setArg = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.etd).toBeNull();
    expect(setArg.notes).toBeNull();

    // O que o banco devolve depois do UPDATE e o que o GET seguinte le.
    expect(result).toMatchObject({ id: 1, etd: null, notes: null });
  });

  it('nao toca no campo cuja chave nao foi enviada', async () => {
    queryQueue.push(createResolvedChain([{ lockedAt: null, lockedReason: null }]));
    queryQueue.push(createResolvedChain([{ id: 1, etd: '2026-05-01' }]));

    await processService.update(1, { notes: 'so a nota' } as any, 7);

    const setArg = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg).not.toHaveProperty('etd');
    expect(setArg.notes).toBe('so a nota');
  });

  it('nao filtra o null do patch antes do SET', async () => {
    // Se `update()` passasse a descartar null, o Zod aceitar nao bastaria: a
    // instrucao de apagar morreria no service e a tela voltaria a mentir 200.
    queryQueue.push(createResolvedChain([{ lockedAt: null, lockedReason: null }]));
    queryQueue.push(createResolvedChain([{ id: 1 }]));
    queryQueue.push(createResolvedChain([]));

    await processService.update(
      1,
      {
        totalFobValue: null,
        totalBoxes: null,
        registeredAt: null,
        customsClearanceAt: null,
        exporterName: null,
      } as any,
      7,
    );

    const setArg = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
    for (const campo of [
      'totalFobValue',
      'totalBoxes',
      'registeredAt',
      'customsClearanceAt',
      'exporterName',
    ]) {
      expect(setArg).toHaveProperty(campo, null);
    }
  });
});
