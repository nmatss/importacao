import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue, txQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/queue/index.js', () => ({
  getQueue: vi.fn().mockResolvedValue({ send: vi.fn() }),
}));

vi.mock('../../audit/service.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../ai/service.js', () => ({
  aiService: { acceptsPdfInput: true, providerName: 'vertex' },
  flattenAiData: vi.fn((data) => data),
}));

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    isConfigured: vi.fn().mockResolvedValue(false),
    isRootConfigured: vi.fn().mockResolvedValue(false),
    uploadToProcessFolder: vi.fn().mockResolvedValue('drive-file-id'),
  },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/state-machine/process-states.js', () => ({
  assertTransition: vi.fn(),
}));

const { mockRecordProcessEvent } = vi.hoisted(() => ({
  mockRecordProcessEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../shared/utils/process-events.js', () => ({
  recordProcessEvent: mockRecordProcessEvent,
}));

vi.mock('../reconcile.js', () => ({
  reconcileProcessConfidence: vi.fn().mockResolvedValue([]),
}));

vi.mock('../ocr.js', () => ({
  ocrScannedPdf: vi.fn().mockResolvedValue(null),
  rasterizePdfPages: vi.fn().mockResolvedValue(null),
}));

const { documentService } = await import('../service.js');
const { auditService } = await import('../../audit/service.js');
const { editComparisonFieldSchema, removeComparisonFieldSchema, acceptComparisonSchema } =
  await import('../schema.js');

const EXPORTER_ROW_KEY = 'aggregate:exportador-shipper';

function comparisonDocs(exporterOnPackingList: string) {
  return [
    {
      id: 10,
      type: 'invoice',
      isProcessed: true,
      confidenceScore: '0.90',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      aiParsedData: { exporterName: 'ACME TRADING LTD' },
    },
    {
      id: 11,
      type: 'packing_list',
      isProcessed: true,
      confidenceScore: '0.90',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      aiParsedData: { exporterName: exporterOnPackingList },
    },
  ];
}

/**
 * Fila de `getComparison`: documentos, processo, overrides, aceites ativos.
 */
function pushComparisonChains(exporterOnPackingList: string, acceptanceRows: any[] = []) {
  queryQueue.push(createResolvedChain(comparisonDocs(exporterOnPackingList)));
  queryQueue.push(createResolvedChain([{ id: 1, aiExtractedData: {} }]));
  queryQueue.push(createResolvedChain([]));
  queryQueue.push(createResolvedChain(acceptanceRows));
}

describe('governanca do comparativo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });

  describe('getComparison() — aceites vem da tabela, nao do timeline', () => {
    it('devolve os aceites ATIVOS e marca a linha correspondente', async () => {
      pushComparisonChains('OUTRA EXPORTADORA SA', [
        {
          id: 77,
          scope: 'aggregate',
          rowKey: EXPORTER_ROW_KEY,
          fieldLabel: 'Exportador / Shipper',
          itemCode: null,
          previousStatus: 'divergent',
          evidenceHash: 'hash-ativo',
          resolutionNote: 'Nome comercial diferente do razao social.',
          acceptedAt: new Date('2026-08-01T12:00:00Z'),
          acceptedBy: 3,
          acceptedByName: 'Eduarda',
        },
      ]);

      const comparison = await documentService.getComparison(1);

      expect(comparison.acceptances).toHaveLength(1);
      expect(comparison.acceptances[0].resolutionNote).toContain('Nome comercial');

      const row: any = comparison.aggregateComparison.find(
        (candidate: any) => candidate.rowKey === EXPORTER_ROW_KEY,
      );
      expect(row).toBeDefined();
      expect(row.accepted).not.toBeNull();
      expect(row.accepted.acceptedByName).toBe('Eduarda');
      expect(row.accepted.id).toBe(77);
    });

    it('nao marca a linha quando o aceite foi invalidado (a query filtra invalidated_at)', async () => {
      // A invalidacao acontece no banco (invalidateComparisonAcceptances), entao
      // a linha simplesmente nao volta na consulta de aceites ativos.
      pushComparisonChains('OUTRA EXPORTADORA SA', []);

      const comparison = await documentService.getComparison(1);

      expect(comparison.acceptances).toHaveLength(0);
      const row: any = comparison.aggregateComparison.find(
        (candidate: any) => candidate.rowKey === EXPORTER_ROW_KEY,
      );
      expect(row.accepted).toBeNull();
    });
  });

  describe('acceptComparison()', () => {
    function pushAcceptChains(options: {
      exporterOnPackingList: string;
      priorRows?: any[];
      insertChain?: any;
      updateChain?: any;
    }) {
      queryQueue.push(createResolvedChain([{ id: 1 }])); // processo existe
      pushComparisonChains(options.exporterOnPackingList);
      queryQueue.push(createResolvedChain(options.priorRows ?? [])); // aceites da celula
      queryQueue.push(options.insertChain ?? createResolvedChain([])); // insert/update do aceite
      queryQueue.push(options.updateChain ?? createResolvedChain([])); // supersede
    }

    const input = {
      scope: 'aggregate' as const,
      rowKey: EXPORTER_ROW_KEY,
      fieldLabel: 'Exportador / Shipper',
      previousStatus: 'divergent' as const,
      resolution_note: 'Divergencia conhecida, aceita pelo fiscal.',
    };

    it('inclui os valores comparados no evidence_hash', async () => {
      const firstInsert = createResolvedChain([]);
      pushAcceptChains({ exporterOnPackingList: 'ACME TRADING LTD', insertChain: firstInsert });
      const first = await documentService.acceptComparison(1, input, 3);

      const secondInsert = createResolvedChain([]);
      pushAcceptChains({
        exporterOnPackingList: 'OUTRA EXPORTADORA SA',
        insertChain: secondInsert,
      });
      const second = await documentService.acceptComparison(1, input, 3);

      // Mesmo payload, valores extraidos diferentes => evidencia diferente.
      expect(first.evidenceHash).toBeDefined();
      expect(second.evidenceHash).toBeDefined();
      expect(second.evidenceHash).not.toBe(first.evidenceHash);
      expect(firstInsert.values.mock.calls[0][0].evidenceHash).toBe(first.evidenceHash);
      expect(secondInsert.values.mock.calls[0][0].evidenceHash).toBe(second.evidenceHash);
    });

    it('nao ressuscita o aceite invalidado: grava linha nova e nao limpa invalidated_at', async () => {
      const insertChain = createResolvedChain([]);
      // Descobre o hash da evidencia atual sem nenhuma linha previa.
      pushAcceptChains({ exporterOnPackingList: 'OUTRA EXPORTADORA SA' });
      const baseline = await documentService.acceptComparison(1, input, 3);

      // Agora a MESMA evidencia ja existe, porem invalidada por reprocessamento.
      pushAcceptChains({
        exporterOnPackingList: 'OUTRA EXPORTADORA SA',
        priorRows: [
          {
            id: 9,
            evidenceHash: baseline.evidenceHash,
            invalidatedAt: new Date('2026-08-02T00:00:00Z'),
          },
        ],
        insertChain,
      });
      const reaffirmed = await documentService.acceptComparison(1, input, 3);

      // Linha NOVA (hash derivado), nunca um update ressuscitando a antiga.
      expect(reaffirmed.evidenceHash).not.toBe(baseline.evidenceHash);
      expect(insertChain.values).toHaveBeenCalled();
      const conflict = insertChain.onConflictDoUpdate.mock.calls[0][0];
      expect(conflict.set).not.toHaveProperty('invalidatedAt');
      expect(conflict.set).not.toHaveProperty('invalidationReason');
      expect(conflict.setWhere).toBeDefined();
    });

    it('atualiza o aceite ATIVO de mesma evidencia em vez de duplicar', async () => {
      pushAcceptChains({ exporterOnPackingList: 'OUTRA EXPORTADORA SA' });
      const baseline = await documentService.acceptComparison(1, input, 3);

      const updateChain = createResolvedChain([]);
      queryQueue.push(createResolvedChain([{ id: 1 }]));
      pushComparisonChains('OUTRA EXPORTADORA SA');
      queryQueue.push(
        createResolvedChain([{ id: 9, evidenceHash: baseline.evidenceHash, invalidatedAt: null }]),
      );
      queryQueue.push(updateChain); // update do aceite ativo
      queryQueue.push(createResolvedChain([])); // supersede

      mockDb.insert.mockClear();
      const again = await documentService.acceptComparison(1, input, 3);

      expect(again.evidenceHash).toBe(baseline.evidenceHash);
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(updateChain.set.mock.calls[0][0]).not.toHaveProperty('invalidatedAt');
    });

    it('grava na trilha de auditoria central', async () => {
      pushAcceptChains({ exporterOnPackingList: 'OUTRA EXPORTADORA SA' });

      await documentService.acceptComparison(1, input, 3);

      expect(auditService.log).toHaveBeenCalledWith(
        3,
        'accept_comparison',
        'process',
        1,
        expect.objectContaining({
          rowKey: EXPORTER_ROW_KEY,
          resolutionNote: 'Divergencia conhecida, aceita pelo fiscal.',
        }),
        null,
      );
    });

    it('invalida aceites anteriores da mesma celula sob outra evidencia', async () => {
      const supersede = createResolvedChain([]);
      pushAcceptChains({
        exporterOnPackingList: 'OUTRA EXPORTADORA SA',
        priorRows: [{ id: 4, evidenceHash: 'evidencia-antiga', invalidatedAt: null }],
        updateChain: supersede,
      });

      await documentService.acceptComparison(1, input, 3);

      expect(supersede.set).toHaveBeenCalledWith(
        expect.objectContaining({ invalidationReason: 'superseded_by_new_acceptance' }),
      );
    });
  });

  describe('schema do comparativo', () => {
    const editPayload = {
      rowKey: 'aggregate:total-fob-usd',
      fieldLabel: 'Total FOB (USD)',
      sourceColumn: 'invoice' as const,
      value: '2000.00',
    };

    it('editar a celula exige justificativa, como aceitar exige', () => {
      // Editar recalcula o status da linha sobre o valor novo (Falha vira
      // Conforme): nao pode ser a unica das tres acoes sem justificativa.
      expect(editComparisonFieldSchema.safeParse(editPayload).success).toBe(false);
      expect(editComparisonFieldSchema.safeParse({ ...editPayload, note: 'ok' }).success).toBe(
        false,
      );
      expect(
        editComparisonFieldSchema.safeParse({ ...editPayload, note: 'valor conferido na invoice' })
          .success,
      ).toBe(true);
      // Mesmo minimo do aceite.
      expect(
        acceptComparisonSchema.safeParse({
          scope: 'aggregate',
          rowKey: 'aggregate:x',
          resolution_note: 'ok',
        }).success,
      ).toBe(false);
    });

    it('remover a edicao tambem exige justificativa', () => {
      expect(
        removeComparisonFieldSchema.safeParse({
          rowKey: 'aggregate:total-fob-usd',
          sourceColumn: 'invoice',
        }).success,
      ).toBe(false);
      expect(
        removeComparisonFieldSchema.safeParse({
          rowKey: 'aggregate:total-fob-usd',
          sourceColumn: 'invoice',
          note: 'restaurar valor extraido',
        }).success,
      ).toBe(true);
    });
  });

  describe('editComparisonField()', () => {
    it('preserva o valor consolidado anterior na auditoria e no timeline', async () => {
      queryQueue.push(createResolvedChain([{ id: 1 }])); // processo
      queryQueue.push(
        createResolvedChain([
          {
            id: 8,
            fieldLabel: 'Total FOB (USD)',
            valueText: '1000.00',
            note: 'ajuste anterior',
            editedBy: 2,
            editedAt: new Date('2026-08-01T10:00:00Z'),
          },
        ]),
      );
      queryQueue.push(createResolvedChain([{ id: 8, valueText: '2000.00' }])); // upsert

      await documentService.editComparisonField(
        1,
        {
          rowKey: 'aggregate:total-fob-usd',
          fieldLabel: 'Total FOB (USD)',
          sourceColumn: 'invoice',
          value: '2000.00',
          note: 'corrigido conforme invoice revisada',
        },
        3,
      );

      expect(auditService.log).toHaveBeenCalledWith(
        3,
        'edit_comparison_field',
        'process',
        1,
        expect.objectContaining({
          previousValue: '1000.00',
          previousNote: 'ajuste anterior',
          previousEditedBy: 2,
        }),
        null,
      );
      const eventMetadata = mockRecordProcessEvent.mock.calls[0][1].metadata;
      expect(eventMetadata.previousValue).toBe('1000.00');
      expect(eventMetadata.previousEditedAt).toBe('2026-08-01T10:00:00.000Z');
    });
  });

  describe('removeComparisonFieldOverride()', () => {
    it('remove o override, restaura o valor extraido e audita', async () => {
      const deleteChain = createResolvedChain([
        {
          id: 8,
          fieldLabel: 'Total FOB (USD)',
          valueText: null,
          note: 'limpei sem querer',
          editedBy: 2,
          editedAt: new Date('2026-08-01T10:00:00Z'),
        },
      ]);
      queryQueue.push(createResolvedChain([{ id: 1 }])); // processo
      queryQueue.push(deleteChain);

      const result = await documentService.removeComparisonFieldOverride(
        1,
        {
          rowKey: 'aggregate:total-fob-usd',
          sourceColumn: 'invoice',
          note: 'restaurar valor extraido',
        },
        3,
      );

      expect(result.removed).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        3,
        'remove_comparison_field_override',
        'process',
        1,
        expect.objectContaining({ previousNote: 'limpei sem querer' }),
        null,
      );
    });

    it('falha quando nao existe override para a celula', async () => {
      queryQueue.push(createResolvedChain([{ id: 1 }]));
      queryQueue.push(createResolvedChain([]));

      await expect(
        documentService.removeComparisonFieldOverride(
          1,
          { rowKey: 'aggregate:x', sourceColumn: 'invoice', note: 'tentativa' },
          3,
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
