import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();
const originalEnv = { ...process.env };

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

const { getOperationalRecipient, normalizeEmailList, parseEmailList } =
  await import('../operational-recipients.js');

describe('operational recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes and deduplicates email lists', () => {
    const value = ' Contact@KIOMGlobal.com ; contact@kiomglobal.com\nops@kiomglobal.com ';

    expect(parseEmailList(value)).toEqual(['contact@kiomglobal.com', 'ops@kiomglobal.com']);
    expect(normalizeEmailList(value)).toBe('contact@kiomglobal.com, ops@kiomglobal.com');
  });

  it('reads recipient from system settings before env fallback', async () => {
    process.env.KIOM_EMAIL = 'env@kiomglobal.com';
    queryQueue.push(
      createResolvedChain([
        {
          id: 1,
          key: 'kiom_email',
          value: 'settings@kiomglobal.com, settings@kiomglobal.com',
        },
      ]),
    );

    await expect(getOperationalRecipient('kiom_email')).resolves.toBe('settings@kiomglobal.com');
  });

  it('falls back to env when setting is missing', async () => {
    process.env.FENICIA_EMAIL = 'Bruna@FeniciaComex.com.br;fenicia.fin@feniciacomex.com.br';
    queryQueue.push(createResolvedChain([]));

    await expect(getOperationalRecipient('fenicia_email')).resolves.toBe(
      'bruna@feniciacomex.com.br, fenicia.fin@feniciacomex.com.br',
    );
  });

  it('keeps an empty system setting instead of falling back to env', async () => {
    process.env.ISA_EMAIL = 'old-isa@example.com';
    queryQueue.push(
      createResolvedChain([
        {
          id: 3,
          key: 'isa_email',
          value: '',
        },
      ]),
    );

    await expect(getOperationalRecipient('isa_email')).resolves.toBe('');
  });
});
