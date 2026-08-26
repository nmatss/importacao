import { beforeEach, describe, expect, it, vi } from 'vitest';

type ErrorListener = (error: Error) => void;

const imapMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    emitError: (error: Error) => void;
  }>,
}));

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(function MockImapFlow() {
    const errorListeners: ErrorListener[] = [];
    const instance = {
      connect: vi.fn().mockRejectedValue(new Error('authentication failed')),
      logout: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event: string, listener: ErrorListener) => {
        if (event === 'error') errorListeners.push(listener);
        return instance;
      }),
      emitError: (error: Error) => {
        for (const listener of errorListeners) listener(error);
      },
    };
    imapMocks.instances.push(instance);
    return instance;
  }),
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('imapService.testConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imapMocks.instances.length = 0;
  });

  it('closes the client and absorbs a late socket error after a failed connection', async () => {
    const { imapService } = await import('../imap.service.js');
    const pending = imapService.testConnection();
    const client = imapMocks.instances[0];

    await expect(pending).resolves.toBe(false);
    expect(client.close).toHaveBeenCalledOnce();
    expect(() => client.emitError(new Error('late socket timeout'))).not.toThrow();
  });
});
