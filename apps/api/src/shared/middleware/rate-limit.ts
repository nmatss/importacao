import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(maxAttempts: number, windowMs: number) {
  const store = new Map<string, RateLimitEntry>();

  // Cleanup expired entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req as any).user?.id?.toString() || req.ip || 'unknown';
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;

    if (entry.count > maxAttempts) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', retryAfter.toString());
      return sendError(res, 'Muitas tentativas. Tente novamente mais tarde.', 429);
    }

    return next();
  };
}
