import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import { cache } from '../cache/redis.js';
import { logger } from '../utils/logger.js';

const KEY_PREFIX = 'rl:';

export function createRateLimiter(maxAttempts: number, windowMs: number) {
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = (req as any).user?.id?.toString() || req.ip || 'unknown';
    const key = `${KEY_PREFIX}${req.path}:${identifier}`;

    try {
      const raw = await cache.get(key);
      let count: number;
      let ttlEnd: number;

      if (raw) {
        const parsed = JSON.parse(raw) as { count: number; resetAt: number };
        count = parsed.count + 1;
        ttlEnd = parsed.resetAt;

        // If the window has already passed (stale entry), start fresh
        if (Date.now() > ttlEnd) {
          count = 1;
          ttlEnd = Date.now() + windowMs;
        }
      } else {
        count = 1;
        ttlEnd = Date.now() + windowMs;
      }

      // Persist updated count with remaining TTL
      const remainingSec = Math.max(1, Math.ceil((ttlEnd - Date.now()) / 1000));
      await cache.set(
        key,
        JSON.stringify({ count, resetAt: ttlEnd }),
        count === 1 ? windowSec : remainingSec,
      );

      // Set rate-limit headers
      const remaining = Math.max(0, maxAttempts - count);
      res.set('X-RateLimit-Limit', maxAttempts.toString());
      res.set('X-RateLimit-Remaining', remaining.toString());
      res.set('X-RateLimit-Reset', Math.ceil(ttlEnd / 1000).toString());

      if (count > maxAttempts) {
        const retryAfter = Math.ceil((ttlEnd - Date.now()) / 1000);
        res.set('Retry-After', retryAfter.toString());
        return sendError(res, 'Muitas tentativas. Tente novamente mais tarde.', 429);
      }

      return next();
    } catch (err) {
      // Fail-open: if cache/Redis is down, allow the request through
      logger.warn({ err }, 'Rate limiter error, allowing request (fail-open)');
      return next();
    }
  };
}
