import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { followUpTracking } from '../../../shared/database/schema.js';

const { mockDb, queryQueue, txQueue } = createMockDb();

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
const { ACTIVE_CHECKLIST_STEPS, CHECKLIST_CATALOG, checklistStepLabel, isActiveChecklistStep } =
  await import('../checklist-catalog.js');

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../../..');

/**
 * Enfileira as consultas de `getChecklist()` na ordem em que o service as faz:
 * processo -> follow_up_tracking -> etapas ocultas -> etapas especificas ->
 * eventos de atribuicao.
 */
function queueChecklistReads(options: {
  tracking?: Record<string, unknown> | null;
  hidden?: { stepKey: string }[];
  customStages?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
}) {
  queryQueue.push(createResolvedChain([{ id: 1 }]));
  queryQueue.push(createResolvedChain(options.tracking ? [options.tracking] : []));
  queryQueue.push(createResolvedChain(options.hidden ?? []));
  queryQueue.push(createResolvedChain(options.customStages ?? []));
  queryQueue.push(createResolvedChain(options.events ?? []));
}

const stage = (over: Record<string, unknown>) => ({
  id: 1,
  processId: 1,
  label: 'Etapa',
  position: 0,
  completedAt: null,
  notes: null,
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
  ...over,
});

describe('catalogo do checklist (D7)', () => {
  it('toda chave do catalogo e uma coluna de follow_up_tracking', () => {
    // Guarda estatica: uma etapa com chave inventada seria gravavel pela tela e
    // estouraria so no banco, em producao.
    const columns = new Set(Object.keys(followUpTracking));
    for (const step of CHECKLIST_CATALOG) {
      expect(columns, `chave ${step.key} nao existe em follow_up_tracking`).toContain(step.key);
    }
  });

  it('mantem inativas as etapas que a reuniao tirou da rotina, sem perder o dado', () => {
    // "coletar assinaturas nao se faz mais"; "enviar invoice Fenicia" e "enviar
    // docs assinados" sao a mesma coisa (reuniao 11/09). Inativa = fora da tela
    // e do progresso, com a coluna e os timestamps preservados.
    expect(isActiveChecklistStep('signaturesCollectedAt')).toBe(false);
    expect(isActiveChecklistStep('signedDocsSentAt')).toBe(false);
    expect(isActiveChecklistStep('invoiceSentFeniciaAt')).toBe(true);

    const catalogKeys = CHECKLIST_CATALOG.map((step) => step.key);
    expect(catalogKeys).toContain('signaturesCollectedAt');
    expect(catalogKeys).toContain('signedDocsSentAt');
  });

  it('rotula sentToFeniciaAt como "Atualizar Follow-up", igual ao import da planilha', () => {
    // Verdade do mapeamento: scripts/import-follow-up.js. `updateFollowUp: 87`
    // e a coluna CJ "Atualizar Follow-up" — o rotulo "Enviado para Fenicia"
    // que a API usava no historico era o errado, nao o da tela (UIP-04).
    const script = readFileSync(path.join(REPO_ROOT, 'scripts/import-follow-up.js'), 'utf8');
    expect(script).toMatch(/updateFollowUp:\s*87,\s*\/\/\s*"Atualizar Follow-up"/);
    expect(checklistStepLabel('sentToFeniciaAt')).toBe('Atualizar Follow-up');
  });

  it('o follow-up nao declara mais rotulos proprios de checklist', () => {
    // Guarda estatica contra a regressao de origem: duas listas, dois rotulos.
    const source = readFileSync(
      path.join(REPO_ROOT, 'apps/api/src/modules/follow-up/service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/TRACKING_STEP_LABELS\s*(:|=)/);
    expect(source).toContain('checklist-catalog.js');
  });
});

describe('processService.getChecklist()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });

  it('devolve so o catalogo ativo, em portugues, sem as etapas aposentadas', async () => {
    queueChecklistReads({ tracking: { processId: 1 } });

    const checklist = await processService.getChecklist(1);
    const labels = checklist.steps.map((step) => step.label);

    expect(checklist.steps).toHaveLength(ACTIVE_CHECKLIST_STEPS.length);
    expect(labels).not.toContain('Coletar Assinaturas');
    expect(labels).not.toContain('Enviar Docs Assinados');
    expect(labels).toContain('Atualizar Follow-up');
    expect(checklist.progress).toEqual({ completed: 0, total: 13, pct: 0 });
  });

  it('insere a etapa especifica na LINHA escolhida (position 3 = terceira linha)', async () => {
    queueChecklistReads({
      tracking: { processId: 1 },
      customStages: [stage({ id: 91, label: 'Vistoria INMETRO', position: 3 })],
    });

    const checklist = await processService.getChecklist(1);

    expect(checklist.steps[2]).toMatchObject({ kind: 'custom', id: 91, label: 'Vistoria INMETRO' });
    expect(checklist.steps[0]).toMatchObject({ kind: 'default', key: 'documentsReceivedAt' });
    expect(checklist.progress.total).toBe(14);
  });

  it('ordena as 5 etapas reais de producao pelas posicoes gravadas, sem migracao', async () => {
    // Linhas reais do processo 275 (posicoes 3, 2 e 4) e do 287 (2 e 3): a
    // leitura 1-based precisa aceita-las como estao.
    queueChecklistReads({
      tracking: { processId: 1 },
      customStages: [
        stage({ id: 2, label: 'teste 2', position: 2, createdAt: new Date('2026-08-02') }),
        stage({ id: 1, label: 'teste', position: 3, createdAt: new Date('2026-08-01') }),
        stage({ id: 3, label: 'teste 3', position: 4, createdAt: new Date('2026-08-03') }),
      ],
    });

    const checklist = await processService.getChecklist(1);

    expect(checklist.steps[1]).toMatchObject({ kind: 'custom', label: 'teste 2' });
    expect(checklist.steps[2]).toMatchObject({ kind: 'custom', label: 'teste' });
    expect(checklist.steps[3]).toMatchObject({ kind: 'custom', label: 'teste 3' });
  });

  it('preserva ordem cronologica em posicoes iguais e colisoes consecutivas', async () => {
    queueChecklistReads({
      customStages: [
        stage({ id: 1, label: 'Primeira', position: 3 }),
        stage({ id: 2, label: 'Segunda', position: 3 }),
        stage({ id: 3, label: 'Terceira', position: 4 }),
      ],
    });
    const checklist = await processService.getChecklist(1);
    expect(checklist.steps.slice(2, 5).map((step) => step.label)).toEqual([
      'Primeira',
      'Segunda',
      'Terceira',
    ]);
    expect(checklist.progress.total).toBe(ACTIVE_CHECKLIST_STEPS.length + 3);
  });

  it('manda para o fim a etapa sem posicao (0, o default antigo) e a posicao alem do total', async () => {
    queueChecklistReads({
      tracking: { processId: 1 },
      customStages: [
        stage({ id: 10, label: 'sem posicao', position: 0 }),
        stage({ id: 11, label: 'muito longe', position: 999 }),
      ],
    });

    const checklist = await processService.getChecklist(1);

    expect(checklist.steps.at(-1)).toMatchObject({ label: 'muito longe' });
    expect(checklist.steps.at(-2)).toMatchObject({ label: 'sem posicao' });
  });

  it('etapa padrao oculta sai da lista E do denominador, sem tocar no timestamp', async () => {
    queueChecklistReads({
      tracking: { processId: 1, sentToFeniciaAt: new Date('2026-09-10T12:00:00.000Z') },
      hidden: [{ stepKey: 'sentToFeniciaAt' }],
    });

    const checklist = await processService.getChecklist(1);

    expect(checklist.steps.map((step) => step.label)).not.toContain('Atualizar Follow-up');
    expect(checklist.progress.total).toBe(12);
    // O dado continua no banco: nada de UPDATE em follow_up_tracking.
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('conta a etapa especifica concluida no progresso e traz quem concluiu a padrao', async () => {
    queueChecklistReads({
      tracking: { processId: 1, documentsReceivedAt: new Date('2026-09-08T12:30:00.000Z') },
      customStages: [
        stage({
          id: 77,
          label: 'Confirmar free time',
          position: 2,
          completedAt: new Date('2026-09-09T10:00:00.000Z'),
        }),
      ],
      events: [
        {
          metadata: {
            step: 'documentsReceivedAt',
            newStatus: 'feito',
            completedByName: 'Odett Ferreira',
            completedAt: '2026-09-08T12:30:00.000Z',
          },
          createdBy: 3,
          createdAt: new Date('2026-09-08T12:30:00.000Z'),
          authorName: 'Odett Ferreira',
        },
      ],
    });

    const checklist = await processService.getChecklist(1);

    expect(checklist.steps[0]).toMatchObject({
      key: 'documentsReceivedAt',
      completedAt: '2026-09-08T12:30:00.000Z',
      completedByName: 'Odett Ferreira',
    });
    expect(checklist.progress).toEqual({ completed: 2, total: 14, pct: 14 });
  });
});

describe('processService.setChecklistStepHidden()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });

  it('grava a ocultacao com audit e evento, sem apagar a coluna do passo', async () => {
    queryQueue.push(createResolvedChain([{ id: 1, lockedAt: null }])); // assertNotLocked
    const insertChain = createResolvedChain([{ id: 5 }]);
    queryQueue.push(insertChain);

    const result = await processService.setChecklistStepHidden(
      1,
      'diDraftAt',
      { hidden: true, reason: 'Processo sem DI nesta operacao' },
      9,
    );

    expect(result).toEqual({ stepKey: 'diDraftAt', label: 'Rascunho da DI', hidden: true });
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ processId: 1, stepKey: 'diDraftAt', hiddenBy: 9 }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      9,
      'hide_checklist_step',
      'process',
      1,
      expect.objectContaining({ stepKey: 'diDraftAt', label: 'Rascunho da DI' }),
      null,
    );
    expect(recordProcessEvent).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ eventType: 'checklist_step_hidden' }),
      9,
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('recusa chave que nao existe no catalogo, em portugues', async () => {
    queryQueue.push(createResolvedChain([{ id: 1, lockedAt: null }]));

    await expect(
      processService.setChecklistStepHidden(1, 'inventado', { hidden: true }, 9),
    ).rejects.toThrow(/Etapa desconhecida no checklist/);
  });
});

describe('movimentacao de etapa existente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    txQueue.length = 0;
  });
  it('move sobre outra custom, persiste ambas posicoes e mantem conclusao', async () => {
    queryQueue.push(createResolvedChain([{ id: 1, lockedAt: null }]));
    const completedAt = new Date('2026-09-12T12:00:00Z');
    const first = stage({ id: 91, position: 3, completedAt });
    const second = stage({ id: 92, position: 4 });
    txQueue.push(createResolvedChain([{ id: 1 }]));
    txQueue.push(createResolvedChain([]));
    txQueue.push(createResolvedChain([]));
    txQueue.push(createResolvedChain([first, second]));
    queryQueue.push(createResolvedChain([])); // attribution
    const saveSecond = createResolvedChain([{ ...second, position: 3 }]);
    const saveFirst = createResolvedChain([{ ...first, position: 4 }]);
    txQueue.push(saveSecond, saveFirst);
    const result = await processService.updateCustomStage(1, 91, { position: 4 }, 7);
    expect(saveSecond.set).toHaveBeenCalledWith({ position: 3, updatedAt: expect.any(Date) });
    expect(saveFirst.set).toHaveBeenCalledWith({ position: 4, updatedAt: expect.any(Date) });
    expect(result.completedAt).toEqual(completedAt);
    expect(mockDb.transaction).toHaveBeenCalledOnce();
    queueChecklistReads({
      customStages: [
        { ...second, position: 3 },
        { ...first, position: 4 },
      ],
    });
    const reread = await processService.getChecklist(1);
    expect(
      reread.steps.slice(2, 4).map((item) => (item.kind === 'custom' ? item.id : item.key)),
    ).toEqual([92, 91]);
    expect(reread.progress.completed).toBe(1);
    expect(recordProcessEvent).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        eventType: 'custom_stage_moved',
        metadata: { stageId: 91, position: 4 },
      }),
      7,
    );
  });

  it('recusa etapa de outro processo sem modificar nenhuma linha', async () => {
    queryQueue.push(createResolvedChain([{ id: 1, lockedAt: null }]));
    txQueue.push(createResolvedChain([{ id: 1 }]));
    txQueue.push(createResolvedChain([]), createResolvedChain([]), createResolvedChain([]));
    queryQueue.push(createResolvedChain([]));
    await expect(processService.updateCustomStage(1, 999, { position: 1 }, 7)).rejects.toThrow();
    expect(auditService.log).not.toHaveBeenCalled();
  });
});
