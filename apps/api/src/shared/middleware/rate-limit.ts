import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import { cache } from '../cache/redis.js';
import { logger } from '../utils/logger.js';

const KEY_PREFIX = 'rl:';
const memoryStore = new Map<string, { count: number; resetAt: number }>();

function pruneExpiredMemoryEntries(now = Date.now()) {
  for (const [key, value] of memoryStore) {
    if (now > value.resetAt) memoryStore.delete(key);
  }
}

function incrementMemory(key: string, windowMs: number) {
  const now = Date.now();
  pruneExpiredMemoryEntries(now);
  const current = memoryStore.get(key);
  if (!current || now > current.resetAt) {
    const next = { count: 1, resetAt: now + windowMs };
    memoryStore.set(key, next);
    return next;
  }
  const next = { count: current.count + 1, resetAt: current.resetAt };
  memoryStore.set(key, next);
  return next;
}

/**
 * Identidade do balde de rate limit.
 *
 * Usava `req.path`, que dentro de um Router montado e RELATIVO — `/login`,
 * `/sync-now`. Duas rotas homonimas em modulos diferentes compartilhariam o
 * mesmo balde. Hoje nao ha colisao real, mas e fragil: basta alguem criar um
 * `/sync-now` em outro modulo. `baseUrl + path` e o caminho completo, sem a
 * query string.
 */
function bucketKey(req: Request): string {
  const identifier =
    (req as { user?: { id?: number | string } }).user?.id?.toString() ?? req.ip ?? 'unknown';
  const route = `${req.baseUrl ?? ''}${req.path}`;
  return `${KEY_PREFIX}${route}:${identifier}`;
}

export function createRateLimiter(maxAttempts: number, windowMs: number) {
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = bucketKey(req);

    try {
      // Incremento ATOMICO. Antes era `get` -> `JSON.parse` -> `set`, sem nada
      // de atomico entre a leitura e a escrita: uma rajada concorrente lia o
      // MESMO contador e escrevia o mesmo valor, e o limite de 5 tentativas por
      // janela do login era ultrapassado com folga por requisicoes paralelas —
      // exatamente o cenario de forca bruta que ele existe para conter.
      const { count, resetAt } = await cache.incr(key, windowSec);

      const remaining = Math.max(0, maxAttempts - count);
      res.set('X-RateLimit-Limit', maxAttempts.toString());
      res.set('X-RateLimit-Remaining', remaining.toString());
      res.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());

      if (count > maxAttempts) {
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
        res.set('Retry-After', retryAfter.toString());
        return sendError(res, 'Muitas tentativas. Tente novamente mais tarde.', 429);
      }

      return next();
    } catch (err) {
      logger.warn({ err }, 'Rate limiter cache error, using in-memory fallback');
      const { count, resetAt } = incrementMemory(`mem:${key}`, windowMs);
      const remaining = Math.max(0, maxAttempts - count);
      res.set('X-RateLimit-Limit', maxAttempts.toString());
      res.set('X-RateLimit-Remaining', remaining.toString());
      res.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());

      if (count > maxAttempts) {
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
        res.set('Retry-After', retryAfter.toString());
        return sendError(res, 'Muitas tentativas. Tente novamente mais tarde.', 429);
      }

      return next();
    }
  };
}
