import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, mockTx, queryQueue, txQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../communications/service.js', () => ({
  communicationService: {
    sendToFenicia: vi.fn(),
    send: vi.fn(),
  },
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
const { communicationService } = await import('../../communications/service.js');

describe('espelhoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
    // Materializacao de process_items roda sob pg_try_advisory_xact_lock:
    // por padrao o teste e o vencedor do lock.
    mockTx.execute.mockResolvedValue([{ acquired: true }]);
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
      queryQueue.push(createResolvedChain(mockItems)); // select items
      queryQueue.push(createResolvedChain([])); // no existing espelhos
      queryQueue.push(createResolvedChain([mockEspelho])); // insert espelho
      queryQueue.push(createResolvedChain(undefined)); // update process
      queryQueue.push(createResolvedChain(undefined)); // update followUp

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

  describe('getEspelhoView()', () => {
    it('returns null when no espelho exists', async () => {
      queryQueue.push(createResolvedChain([])); // getEspelho → none

      const result = await espelhoService.getEspelhoView(1);
      expect(result).toBeNull();
    });

    it('always serializes items as an array (never undefined) so the frontend .map() cannot crash', async () => {
      const mockEspelho = { id: 10, processId: 1, version: 1, brand: 'puket' };
      queryQueue.push(createResolvedChain([mockEspelho])); // getEspelho
      queryQueue.push(createResolvedChain([])); // process_items → empty

      const result = await espelhoService.getEspelhoView(1);
      expect(Array.isArray(result!.items)).toBe(true);
      expect(result!.items).toHaveLength(0);
      expect(result!.totalFobValue).toBe(0);
    });

    it('maps process items to the view shape and aggregates totals', async () => {
      const mockEspelho = { id: 10, processId: 1, version: 1, brand: 'puket' };
      const mockItems = [
        {
          id: 1,
          processId: 1,
          itemCode: 'A001',
          description: 'Thing',
          color: 'BLUE',
          size: 'M',
          ncmCode: '6404.19.00',
          unitPrice: '5.50',
          quantity: 100,
          totalPrice: '550.00',
          boxQuantity: 50,
          netWeight: '30.000',
          grossWeight: '35.000',
          isFreeOfCharge: false,
          requiresLi: true,
          requiresCertification: false,
        },
      ];
      queryQueue.push(createResolvedChain([mockEspelho])); // getEspelho
      queryQueue.push(createResolvedChain(mockItems)); // process_items

      const result = await espelhoService.getEspelhoView(1);
      expect(result!.items).toHaveLength(1);
      const it = result!.items[0];
      expect(it).toMatchObject({
        id: 1,
        itemCode: 'A001',
        ncm: '6404.19.00',
        boxes: 50,
        netWeight: 30,
        grossWeight: 35,
        isFoc: false,
        requiresLi: true,
        requiresCert: false,
      });
      expect(result!.totalFobValue).toBe(550);
      expect(result!.totalQuantity).toBe(100);
      expect(result!.totalBoxes).toBe(50);
      expect(result!.totalNetWeight).toBe(30);
      expect(result!.totalGrossWeight).toBe(35);
    });
  });

  describe('sendToFeniciaByProcess()', () => {
    it('should send the Fenicia communication before marking the espelho as sent', async () => {
      const mockEspelho = { id: 10, processId: 1, version: 1, brand: 'puket' };
      const mockCommunication = { id: 55, processId: 1, status: 'draft' };

      vi.mocked(communicationService.sendToFenicia).mockResolvedValue(mockCommunication as any);
      vi.mocked(communicationService.send).mockResolvedValue({
        ...mockCommunication,
        status: 'sent',
      } as any);

      queryQueue.push(createResolvedChain([mockEspelho])); // getEspelho
      queryQueue.push(createResolvedChain([mockEspelho])); // mark espelho sent
      queryQueue.push(createResolvedChain([{ status: 'espelho_generated' }])); // current process
      queryQueue.push(createResolvedChain(undefined)); // update process
      queryQueue.push(createResolvedChain(undefined)); // update follow-up
      queryQueue.push(createResolvedChain([{ processCode: 'IMP-001' }])); // milestone process code

      const result = await espelhoService.sendToFeniciaByProcess(1, 7);

      expect(result).toEqual(mockEspelho);
      expect(communicationService.sendToFenicia).toHaveBeenCalledWith(1);
      expect(communicationService.send).toHaveBeenCalledWith(55, undefined, 7);
      expect(
        vi.mocked(communicationService.sendToFenicia).mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(communicationService.send).mock.invocationCallOrder[0]);
      expect(auditService.log).toHaveBeenCalledWith(
        7,
        'sent_to_fenicia',
        'espelho',
        10,
        { processId: 1 },
        null,
      );
    });

    it('should not mark the espelho as sent when the email send fails', async () => {
      const mockEspelho = { id: 10, processId: 1, version: 1, brand: 'puket' };
      const mockCommunication = { id: 55, processId: 1, status: 'draft' };

      vi.mocked(communicationService.sendToFenicia).mockResolvedValue(mockCommunication as any);
      vi.mocked(communicationService.send).mockRejectedValue(new Error('SMTP indisponivel'));

      queryQueue.push(createResolvedChain([mockEspelho])); // getEspelho

      await expect(espelhoService.sendToFeniciaByProcess(1, 7)).rejects.toThrow(
        'SMTP indisponivel',
      );

      expect(communicationService.sendToFenicia).toHaveBeenCalledWith(1);
      expect(communicationService.send).toHaveBeenCalledWith(55, undefined, 7);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('autoPopulateItems()', () => {
    function invoiceDoc(overrides: Record<string, any> = {}) {
      return {
        id: 5,
        processId: 1,
        type: 'invoice',
        isProcessed: true,
        confidenceScore: '0.90',
        createdAt: new Date('2026-08-20T00:00:00Z'),
        aiParsedData: { items: [] },
        ...overrides,
      };
    }

    /**
     * Fila de `autoPopulateItems`: documentos e ultima execucao de extracao no
     * `db`; recheque sob o lock e insercao na transacao.
     */
    function pushChains(options: {
      docs: any[];
      runs?: any[];
      existing?: any[];
      insertChain?: any;
      updateChain?: any;
    }) {
      queryQueue.push(createResolvedChain(options.docs));
      queryQueue.push(createResolvedChain(options.runs ?? [{ id: 42 }]));
      txQueue.push(createResolvedChain(options.existing ?? []));
      txQueue.push(options.insertChain ?? createResolvedChain([{ id: 1 }]));
      queryQueue.push(options.updateChain ?? createResolvedChain([]));
    }

    it('nao marca como FOC o item cujo preco a IA simplesmente nao leu', async () => {
      const doc = invoiceDoc({
        aiParsedData: {
          items: [
            { description: 'CAMISETA SEM PRECO EXTRAIDO' },
            { description: 'AMOSTRA GRATUITA', unitPrice: 0, quantity: 10 },
            { description: 'CAMISETA NORMAL', unitPrice: 12.5, quantity: 2 },
          ],
        },
      });

      const insertChain = createResolvedChain([
        { id: 1, requiresLi: false, isFreeOfCharge: false },
      ]);
      pushChains({ docs: [doc], insertChain });

      await espelhoService.autoPopulateItems(1);

      const inserted = insertChain.values.mock.calls[0][0];

      // (a) campo ausente NAO vira zero e NAO vira declaracao de gratuidade
      expect(inserted[0].isFreeOfCharge).toBe(false);
      expect(inserted[0].unitPrice).toBeNull();
      expect(inserted[0].quantity).toBeNull();
      expect(inserted[0].totalPrice).toBeNull();

      // (b) zero legitimo E o dado: preserva o 0 em vez de gravar null
      expect(inserted[1].isFreeOfCharge).toBe(true);
      expect(inserted[1].unitPrice).toBe('0');
      expect(inserted[1].quantity).toBe(10);
      expect(inserted[1].totalPrice).toBe('0');

      expect(inserted[2].isFreeOfCharge).toBe(false);
      expect(inserted[2].unitPrice).toBe('12.5');
      expect(inserted[2].quantity).toBe(2);
      expect(inserted[2].totalPrice).toBe('25');
    });

    it('preserva quantidade zero declarada em vez de converter para null', async () => {
      const doc = invoiceDoc({
        aiParsedData: { items: [{ description: 'ITEM ZERADO', unitPrice: 3, quantity: 0 }] },
      });
      const insertChain = createResolvedChain([{ id: 1 }]);
      pushChains({ docs: [doc], insertChain });

      await espelhoService.autoPopulateItems(1);

      const inserted = insertChain.values.mock.calls[0][0];
      expect(inserted[0].quantity).toBe(0);
      expect(inserted[0].totalPrice).toBe('0');
    });

    it('trata celula vazia/espaco como ausente, nao como zero declarado', async () => {
      const doc = invoiceDoc({
        aiParsedData: { items: [{ description: 'SEM PRECO', unitPrice: '   ', quantity: '' }] },
      });
      const insertChain = createResolvedChain([{ id: 1 }]);
      pushChains({ docs: [doc], insertChain });

      await espelhoService.autoPopulateItems(1);

      const inserted = insertChain.values.mock.calls[0][0];
      expect(inserted[0].unitPrice).toBeNull();
      expect(inserted[0].quantity).toBeNull();
      expect(inserted[0].isFreeOfCharge).toBe(false);
    });

    it('ordena os documentos (ADR 0006) em vez de usar invoiceDocs[0]', async () => {
      const selectChain = createResolvedChain([]);
      queryQueue.push(selectChain);

      await espelhoService.autoPopulateItems(1);

      expect(selectChain.orderBy).toHaveBeenCalled();
    });

    it('nao popula process_items a partir de invoice abaixo do piso de confianca', async () => {
      const doc = invoiceDoc({
        confidenceScore: '0.30',
        aiParsedData: { items: [{ description: 'ITEM', unitPrice: 10, quantity: 1 }] },
      });
      queryQueue.push(createResolvedChain([doc]));

      const result = await espelhoService.autoPopulateItems(1);

      expect(result).toEqual([]);
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockTx.insert).not.toHaveBeenCalled();
    });

    it('ignora extracao falha e usa a proxima invoice utilizavel', async () => {
      const failed = invoiceDoc({ id: 9, aiParsedData: { extractionFailed: true } });
      const usable = invoiceDoc({
        id: 8,
        aiParsedData: { items: [{ description: 'BOM', unitPrice: 4, quantity: 3 }] },
      });
      const insertChain = createResolvedChain([{ id: 1 }]);
      pushChains({ docs: [failed, usable], insertChain });

      await espelhoService.autoPopulateItems(1);

      const inserted = insertChain.values.mock.calls[0][0];
      expect(inserted).toHaveLength(1);
      expect(inserted[0].description).toBe('BOM');
    });

    it('grava a linhagem (documento, execucao de extracao e materializacao)', async () => {
      const doc = invoiceDoc({
        id: 8,
        aiParsedData: { items: [{ description: 'ITEM', unitPrice: 4, quantity: 3 }] },
      });
      const insertChain = createResolvedChain([{ id: 1 }]);
      pushChains({ docs: [doc], runs: [{ id: 91 }], insertChain });

      await espelhoService.autoPopulateItems(1);

      const inserted = insertChain.values.mock.calls[0][0];
      expect(inserted[0].sourceDocumentId).toBe(8);
      expect(inserted[0].extractionRunId).toBe(91);
      expect(inserted[0].materializedAt).toBeInstanceOf(Date);
    });

    it('insere sob pg_try_advisory_xact_lock e re-checa items dentro da transacao', async () => {
      const doc = invoiceDoc({
        aiParsedData: { items: [{ description: 'ITEM', unitPrice: 4, quantity: 3 }] },
      });
      pushChains({ docs: [doc] });

      await espelhoService.autoPopulateItems(1);

      const lockSql = JSON.stringify(mockTx.execute.mock.calls[0][0]);
      expect(lockSql).toContain('pg_try_advisory_xact_lock');
      expect(mockTx.select).toHaveBeenCalled();
      expect(mockTx.insert).toHaveBeenCalled();
      // A insercao acontece na MESMA transacao do lock, nunca fora dela.
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('clique duplo: o segundo generate encontra os itens sob o lock e nao insere', async () => {
      const doc = invoiceDoc({
        aiParsedData: { items: [{ description: 'ITEM', unitPrice: 4, quantity: 3 }] },
      });
      const existing = [{ id: 1, processId: 1, description: 'ITEM' }];
      const insertChain = createResolvedChain([{ id: 2 }]);
      queryQueue.push(createResolvedChain([doc]));
      queryQueue.push(createResolvedChain([{ id: 42 }]));
      txQueue.push(createResolvedChain(existing));
      txQueue.push(insertChain);

      const result = await espelhoService.autoPopulateItems(1);

      expect(result).toEqual(existing);
      expect(mockTx.insert).not.toHaveBeenCalled();
      expect(insertChain.values).not.toHaveBeenCalled();
      // Sem insercao nao ha reescrita das flags do processo.
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('quando o lock ja esta tomado, espera o vencedor e devolve o que ele gravou', async () => {
      const doc = invoiceDoc({
        aiParsedData: { items: [{ description: 'ITEM', unitPrice: 4, quantity: 3 }] },
      });
      const existing = [{ id: 1, processId: 1, description: 'ITEM' }];
      mockTx.execute.mockResolvedValueOnce([{ acquired: false }]);
      queryQueue.push(createResolvedChain([doc]));
      queryQueue.push(createResolvedChain([{ id: 42 }]));
      txQueue.push(createResolvedChain(existing));

      const result = await espelhoService.autoPopulateItems(1);

      expect(result).toEqual(existing);
      expect(mockTx.insert).not.toHaveBeenCalled();
      const waited = mockTx.execute.mock.calls.map((call: any[]) => JSON.stringify(call[0])).join();
      expect(waited).toContain('pg_advisory_xact_lock');
    });
  });
});
