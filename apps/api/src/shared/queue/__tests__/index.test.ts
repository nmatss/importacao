import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pgBossMock = vi.hoisted(() => {
  const instances: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    createQueue: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }> = [];

  const PgBoss = vi.fn().mockImplementation(function MockPgBoss() {
    const instance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    instances.push(instance);
    return instance;
  });

  return { PgBoss, instances };
});

vi.mock('pg-boss', () => ({
  default: pgBossMock.PgBoss,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const originalDatabaseUrl = process.env.DATABASE_URL;

describe('job queue initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    pgBossMock.instances.length = 0;
    process.env.DATABASE_URL = 'postgres://importacao:importacao@localhost:5432/importacao';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('creates all durable queues before the queue is reused', async () => {
    const { initQueue, QUEUE_NAMES } = await import('../index.js');

    const boss = await initQueue();

    expect(pgBossMock.PgBoss).toHaveBeenCalledTimes(1);
    expect(boss).toBe(pgBossMock.instances[0]);
    expect(pgBossMock.instances[0].start).toHaveBeenCalledTimes(1);
    expect(pgBossMock.instances[0].createQueue).toHaveBeenCalledTimes(QUEUE_NAMES.length);
    expect(pgBossMock.instances[0].createQueue).toHaveBeenNthCalledWith(
      1,
      'drive-sync',
      expect.objectContaining({ name: 'drive-sync' }),
    );
    expect(pgBossMock.instances[0].createQueue).toHaveBeenNthCalledWith(
      2,
      'sheets-sync',
      expect.objectContaining({ name: 'sheets-sync' }),
    );
    expect(pgBossMock.instances[0].createQueue).toHaveBeenNthCalledWith(
      3,
      'ai-extraction',
      expect.objectContaining({ name: 'ai-extraction' }),
    );
  });

  it('declara a politica de retry, em vez de herdar o default da biblioteca', async () => {
    // `createQueue(name)` sem opcoes deixava a politica a cargo do default do
    // pg-boss, que muda entre versoes. `ai-extraction` ja passava `retryLimit`
    // no envio; as outras duas filas herdavam um default que ninguem sabia qual
    // era. Este caso congela a decisao explicita.
    const { initQueue, QUEUE_RETRY_POLICY } = await import('../index.js');
    await initQueue();

    expect(QUEUE_RETRY_POLICY.retryLimit).toBeGreaterThan(0);
    expect(QUEUE_RETRY_POLICY.retryBackoff).toBe(true);

    for (const call of pgBossMock.instances[0].createQueue.mock.calls) {
      expect(call[1]).toMatchObject(QUEUE_RETRY_POLICY);
    }
  });

  it('nao cria mais a fila `email-send`', async () => {
    // Removida em 2026-08-29: era um caminho morto (nenhum enfileirador em todo
    // o repositorio) que enviava e-mail SEM a allow-list de destinatario e SEM
    // a sanitizacao de HTML aplicadas por `communicationService.send()`. Este
    // caso congela a remocao para que o atalho nao volte por conveniencia.
    const { initQueue, QUEUE_NAMES } = await import('../index.js');
    await initQueue();

    expect(QUEUE_NAMES).not.toContain('email-send');
    expect(pgBossMock.instances[0].createQueue).not.toHaveBeenCalledWith('email-send');
  });

  it('reuses an initialized queue without recreating queues', async () => {
    const { initQueue, QUEUE_NAMES } = await import('../index.js');

    await initQueue();
    await initQueue();

    expect(pgBossMock.PgBoss).toHaveBeenCalledTimes(1);
    expect(pgBossMock.instances[0].createQueue).toHaveBeenCalledTimes(QUEUE_NAMES.length);
  });
});
