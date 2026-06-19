import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../cache/redis.js', () => ({
  cache: {
    get: mocks.get,
    set: mocks.set,
    del: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { createRateLimiter } = await import('../rate-limit.js');

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/login',
    originalUrl: '/api/auth/login',
    url: '/login',
    ip: '203.0.113.7',
    header: vi.fn(),
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(null);
    mocks.set.mockResolvedValue(undefined);
  });

  it('allows requests on the happy path and persists the counter', async () => {
    const limiter = createRateLimiter(5, 60_000);
    const req = makeReq({ path: '/things', originalUrl: '/api/things', url: '/things' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await limiter(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledOnce();
    expect(res.set).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
  });

  it('fails OPEN for non-auth endpoints when the store errors', async () => {
    mocks.get.mockRejectedValue(new Error('redis down'));
    const limiter = createRateLimiter(5, 60_000);
    const req = makeReq({ path: '/things', originalUrl: '/api/things', url: '/things' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await limiter(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fails CLOSED for auth endpoints when the store errors, throttling brute-force via the in-process fallback', async () => {
    mocks.get.mockRejectedValue(new Error('redis down'));
    const maxAttempts = 3;
    const limiter = createRateLimiter(maxAttempts, 60_000);
    // Same attacker IP hammering /auth/login while Redis is unavailable.
    const ip = '198.51.100.42';

    const allowedCount = (
      await Promise.all(
        Array.from({ length: 10 }, async () => {
          const req = makeReq({
            path: '/login',
            originalUrl: '/api/auth/login',
            url: '/login',
            ip,
          });
          const res = makeRes();
          const next = vi.fn() as unknown as NextFunction;
          await limiter(req, res, next);
          return { allowed: (next as any).mock.calls.length > 0, res };
        }),
      )
    ).filter((r) => r.allowed).length;

    // Protection must NOT silently disappear: only up to maxAttempts get through.
    expect(allowedCount).toBe(maxAttempts);
  });

  it('fails CLOSED when failClosed option is set, even for a non-auth path', async () => {
    mocks.get.mockRejectedValue(new Error('redis down'));
    const limiter = createRateLimiter(1, 60_000, { failClosed: true });
    const ip = '198.51.100.99';

    const first = makeRes();
    const firstNext = vi.fn() as unknown as NextFunction;
    await limiter(
      makeReq({ path: '/sensitive', originalUrl: '/api/sensitive', url: '/sensitive', ip }),
      first,
      firstNext,
    );
    expect(firstNext).toHaveBeenCalledOnce();

    const second = makeRes();
    const secondNext = vi.fn() as unknown as NextFunction;
    await limiter(
      makeReq({ path: '/sensitive', originalUrl: '/api/sensitive', url: '/sensitive', ip }),
      second,
      secondNext,
    );
    expect(secondNext).not.toHaveBeenCalled();
    expect(second.status).toHaveBeenCalledWith(429);
  });
});
