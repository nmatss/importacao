import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { dateRangeBounds, inspectSql } from '../../../__tests__/helpers/sql-inspect.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { emailProcessor } = await import('../processor.js');

describe('emailProcessor.getLogs() — recorte por periodo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  it('cobre o dia local inteiro, com limite superior exclusivo', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await emailProcessor.getLogs(1, 20, '2026-08-29', '2026-08-29');

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

    await expect(emailProcessor.getLogs(1, 20, 'abc')).resolves.toBeDefined();
    expect(mockDb.select.mock.results[0].value.where).toHaveBeenCalledWith(undefined);
  });
});

describe('emailProcessor.getLogs() — filtro por status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  it('aplica o status na clausula WHERE', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await emailProcessor.getLogs(1, 20, undefined, undefined, { status: 'failed' });

    const where = mockDb.select.mock.results[0].value.where.mock.calls[0][0];
    const { text, params } = inspectSql(where);
    expect(text).toContain('"status"');
    expect(params).toContain('failed');
  });

  it('nao filtra por status quando o parametro nao vem', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await emailProcessor.getLogs(1, 20);

    expect(mockDb.select.mock.results[0].value.where).toHaveBeenCalledWith(undefined);
  });

  it('combina status com o recorte por periodo', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ total: 0 }]));

    await emailProcessor.getLogs(1, 20, '2026-08-29', '2026-08-29', { status: 'failed' });

    const where = mockDb.select.mock.results[0].value.where.mock.calls[0][0];
    const { params } = inspectSql(where);
    expect(params).toContain('failed');

    // O status nao pode deslocar os limites de data.
    const { start, end } = dateRangeBounds(where);
    expect(start!.toISOString()).toBe('2026-08-29T03:00:00.000Z');
    expect(end!.toISOString()).toBe('2026-08-30T03:00:00.000Z');
  });
});
