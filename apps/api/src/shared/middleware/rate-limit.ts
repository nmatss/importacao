import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import { cache } from '../cache/redis.js';
import { logger } from '../utils/logger.js';

const KEY_PREFIX = 'rl:';

export interface RateLimiterOptions {
  /**
   * When true, a store (Redis) outage does NOT silently disable the limiter.
   * Instead an in-process fallback limiter takes over so brute-force protection
   * stays in place. Use this for sensitive endpoints (e.g. auth/login) where
   * availability must not trump security. Defaults to false (fail-open) so the
   * rest of the API stays available if the cache is down.
   *
   * Note: requests to authentication endpoints are ALWAYS treated as
   * fail-closed regardless of this flag (see AUTH_PATH_PATTERN), so that
   * brute-force protection on /auth/login and /auth/google cannot silently
   * disappear during a Redis outage even if the route does not pass this
   * option explicitly.
   */
  failClosed?: boolean;
}

// Authentication endpoints whose brute-force protection must never silently
// vanish on a cache outage. Matched against req.originalUrl so it works
// regardless of where the auth router is mounted. Kept narrow on purpose —
// only the credential-accepting endpoints, not the whole /auth surface.
const AUTH_PATH_PATTERN = /\/auth\/(login|google)(\/|$|\?)/;

function isAuthEndpoint(req: Request): boolean {
  const url = req.originalUrl || req.url || '';
  return AUTH_PATH_PATTERN.test(url);
}

// ── In-process fallback limiter ──────────────────────────────────────
// Used only when the shared cache (Redis) errors AND the limiter is
// configured fail-closed. It is intentionally simple and per-process: it
// cannot coordinate across instances, but it guarantees brute-force
// protection does not vanish entirely during a Redis outage.
interface FallbackEntry {
  count: number;
  resetAt: number;
}

const fallbackStore = new Map<string, FallbackEntry>();

// Bound memory: opportunistically drop expired entries when the map grows.
function pruneFallbackStore(now: number): void {
  if (fallbackStore.size < 10_000) return;
  for (const [key, entry] of fallbackStore) {
    if (now > entry.resetAt) fallbackStore.delete(key);
  }
}

function checkFallback(
  key: string,
  maxAttempts: number,
  windowMs: number,
): { limited: boolean; resetAt: number } {
  const now = Date.now();
  pruneFallbackStore(now);

  const existing = fallbackStore.get(key);
  if (!existing || now > existing.resetAt) {
    fallbackStore.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, resetAt: now + windowMs };
  }

  existing.count += 1;
  return { limited: existing.count > maxAttempts, resetAt: existing.resetAt };
}

export function createRateLimiter(
  maxAttempts: number,
  windowMs: number,
  options: RateLimiterOptions = {},
) {
  const windowSec = Math.ceil(windowMs / 1000);
  const failClosedOption = options.failClosed ?? false;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Auth endpoints are always fail-closed so brute-force protection cannot
    // silently disappear when the cache is down.
    const failClosed = failClosedOption || isAuthEndpoint(req);
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
      if (failClosed) {
        // Sensitive endpoint: do NOT silently disable protection. Fall back to
        // the in-process limiter so brute-force attempts are still throttled
        // even while the shared cache is unavailable.
        const { limited, resetAt } = checkFallback(key, maxAttempts, windowMs);
        logger.warn(
          { err, limited },
          'Rate limiter store error on fail-closed endpoint, using in-process fallback',
        );
        if (limited) {
          const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
          res.set('Retry-After', retryAfter.toString());
          return sendError(res, 'Muitas tentativas. Tente novamente mais tarde.', 429);
        }
        return next();
      }

      // Fail-open: if cache/Redis is down, allow the request through. Used for
      // non-sensitive endpoints where availability is preferred over strict
      // throttling.
      logger.warn({ err }, 'Rate limiter error, allowing request (fail-open)');
      return next();
    }
  };
}
