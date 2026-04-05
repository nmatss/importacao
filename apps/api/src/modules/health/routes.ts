import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { cache } from '../../shared/cache/redis.js';
import { logger } from '../../shared/utils/logger.js';

const router = Router();

/**
 * GET /health/live — liveness probe
 * Returns 200 if the process is running.
 */
router.get('/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /health/ready — readiness probe
 * Checks DB and Redis connectivity before returning 200.
 * Returns 503 if any dependency is unavailable.
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; error?: string }> = {};

  // Check DB
  try {
    await db.execute(sql`SELECT 1`);
    checks.db = { ok: true };
  } catch (err: any) {
    logger.error({ err }, 'Health check: DB unavailable');
    checks.db = { ok: false, error: err.message };
  }

  // Check Redis
  try {
    await cache.set('health:ping', '1', 5);
    const val = await cache.get('health:ping');
    checks.redis = { ok: val === '1' };
  } catch (err: any) {
    logger.error({ err }, 'Health check: Redis unavailable');
    checks.redis = { ok: false, error: err.message };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const status = allOk ? 200 : 503;

  res.status(status).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

export { router as healthRoutes };
