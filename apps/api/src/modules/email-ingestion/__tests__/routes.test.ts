import { describe, it, expect, vi } from 'vitest';

/**
 * `/history-scan` sweeps up to 12 months with includeRead=true, downloading
 * every attachment inside the HTTP request, and the cron's `isRunning` latch
 * does not cover this path. It must be rate limited like `/trigger`.
 */

const registered: Array<{ method: string; path: string; handlers: any[] }> = [];
const rateLimiters = new Map<any, { maxAttempts: number; windowMs: number }>();

vi.mock('express', () => ({
  Router: () => {
    const router: any = {
      use: vi.fn(),
      get: (path: string, ...handlers: any[]) => registered.push({ method: 'get', path, handlers }),
      post: (path: string, ...handlers: any[]) =>
        registered.push({ method: 'post', path, handlers }),
    };
    return router;
  },
}));

vi.mock('../../../shared/middleware/auth.js', () => ({
  authMiddleware: vi.fn(),
  adminMiddleware: vi.fn(),
}));

vi.mock('../../../shared/middleware/validate.js', () => ({
  validate: () => vi.fn(),
}));

vi.mock('../../../shared/middleware/rate-limit.js', () => ({
  createRateLimiter: (maxAttempts: number, windowMs: number) => {
    const limiter = vi.fn();
    rateLimiters.set(limiter, { maxAttempts, windowMs });
    return limiter;
  },
}));

vi.mock('../controller.js', () => ({
  emailIngestionController: {
    getStatus: vi.fn(),
    getLogs: vi.fn(),
    triggerCheck: vi.fn(),
    historyScan: vi.fn(),
    reprocess: vi.fn(),
  },
}));

await import('../routes.js');

function limiterFor(path: string) {
  const route = registered.find((entry) => entry.path === path);
  expect(route, `route ${path} is not registered`).toBeDefined();
  return route!.handlers.map((handler) => rateLimiters.get(handler)).find(Boolean);
}

describe('email-ingestion routes', () => {
  it('rate limits POST /history-scan', () => {
    const limiter = limiterFor('/history-scan');
    expect(limiter).toBeDefined();
    expect(limiter!.maxAttempts).toBeGreaterThan(0);
  });

  it('keeps /history-scan stricter than /trigger — it is the far heavier sweep', () => {
    const history = limiterFor('/history-scan')!;
    const trigger = limiterFor('/trigger')!;
    const historyRate = history.maxAttempts / history.windowMs;
    const triggerRate = trigger.maxAttempts / trigger.windowMs;
    expect(historyRate).toBeLessThan(triggerRate);
  });
});
