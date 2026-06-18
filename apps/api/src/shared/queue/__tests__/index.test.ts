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
    expect(pgBossMock.instances[0].createQueue).toHaveBeenNthCalledWith(1, 'email-send');
    expect(pgBossMock.instances[0].createQueue).toHaveBeenNthCalledWith(2, 'drive-sync');
    expect(pgBossMock.instances[0].createQueue).toHaveBeenNthCalledWith(3, 'sheets-sync');
    expect(pgBossMock.instances[0].createQueue).toHaveBeenNthCalledWith(4, 'ai-extraction');
  });

  it('reuses an initialized queue without recreating queues', async () => {
    const { initQueue, QUEUE_NAMES } = await import('../index.js');

    await initQueue();
    await initQueue();

    expect(pgBossMock.PgBoss).toHaveBeenCalledTimes(1);
    expect(pgBossMock.instances[0].createQueue).toHaveBeenCalledTimes(QUEUE_NAMES.length);
  });
});
