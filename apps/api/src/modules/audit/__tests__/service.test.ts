import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { dateRangeBounds } from '../../../__tests__/helpers/sql-inspect.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { auditService } = await import('../service.js');

function capturedWhere() {
  // A listagem e a contagem recebem a mesma clausula; basta olhar a primeira.
  const chain = mockDb.select.mock.results[0].value;
  return chain.where.mock.calls[0][0];
}

describe('auditService.getLogs() — recorte por periodo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  it('cobre o dia local inteiro quando inicio e fim sao o mesmo dia', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await auditService.getLogs({
      page: 1,
      limit: 20,
      startDate: '2026-08-29',
      endDate: '2026-08-29',
    });

    const { start, end } = dateRangeBounds(capturedWhere());
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();

    // Antes o par era `>= X AND <= X` — um unico instante, resultado vazio.
    expect(end!.getTime()).toBeGreaterThan(start!.getTime());

    // America/Sao_Paulo (UTC-3): 29/08 00:00 local = 29/08 03:00 UTC.
    expect(start!.toISOString()).toBe('2026-08-29T03:00:00.000Z');
    expect(end!.toISOString()).toBe('2026-08-30T03:00:00.000Z');

    // Ultimo instante do dia local escolhido entra; primeiro instante do dia
    // local seguinte fica de fora.
    const ultimoInstanteLocal = new Date('2026-08-29T23:59:59.999-03:00');
    const primeiroInstanteDoDiaSeguinte = new Date('2026-08-30T00:00:00.000-03:00');
    expect(ultimoInstanteLocal.getTime()).toBeGreaterThanOrEqual(start!.getTime());
    expect(ultimoInstanteLocal.getTime()).toBeLessThan(end!.getTime());
    expect(primeiroInstanteDoDiaSeguinte.getTime()).toBeGreaterThanOrEqual(end!.getTime());
  });

  it('ignora data invalida em vez de estourar "Invalid time value"', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await expect(
      auditService.getLogs({ page: 1, limit: 20, startDate: 'abc', endDate: '2026-13-45' }),
    ).resolves.toBeDefined();

    const chain = mockDb.select.mock.results[0].value;
    expect(chain.where).toHaveBeenCalledWith(undefined);
  });
});
