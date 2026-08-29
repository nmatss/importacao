import { describe, it, expect, vi, beforeEach } from 'vitest';
import { asc } from 'drizzle-orm';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { dateRangeBounds } from '../../../__tests__/helpers/sql-inspect.js';
import { liTracking } from '../../../shared/database/schema.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

const { liTrackingService } = await import('../service.js');

function listChain() {
  return mockDb.select.mock.results[0].value;
}

describe('liTrackingService.getAll()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  it('converte o dia local escolhido no intervalo UTC equivalente', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await liTrackingService.getAll(1, 50, { startDate: '2026-08-29', endDate: '2026-08-29' });

    const { start, end } = dateRangeBounds(listChain().where.mock.calls[0][0]);
    // America/Sao_Paulo (UTC-3): meia-noite local = 03:00 UTC.
    expect(start!.toISOString()).toBe('2026-08-29T03:00:00.000Z');
    expect(end!.toISOString()).toBe('2026-08-30T03:00:00.000Z');

    const ultimoInstanteLocal = new Date('2026-08-29T23:59:59.999-03:00');
    const primeiroInstanteDoDiaSeguinte = new Date('2026-08-30T00:00:00.000-03:00');
    expect(ultimoInstanteLocal.getTime()).toBeLessThan(end!.getTime());
    expect(primeiroInstanteDoDiaSeguinte.getTime()).toBeGreaterThanOrEqual(end!.getTime());
  });

  it('ignora data invalida em vez de estourar', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await expect(liTrackingService.getAll(1, 50, { startDate: 'abc' })).resolves.toBeDefined();
    expect(listChain().where).toHaveBeenCalledWith(undefined);
  });

  it('pagina com desempate estavel por id', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await liTrackingService.getAll(2, 50, {});

    // createdAt nao e unico entre linhas importadas em lote: sem o desempate a
    // ordem entre paginas fica indefinida e registros somem ou repetem.
    expect(listChain().orderBy).toHaveBeenCalledWith(asc(liTracking.createdAt), asc(liTracking.id));
  });
});
