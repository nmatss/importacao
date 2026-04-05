import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { getQueue } from '../../shared/queue/index.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';
import { queueStatsQuerySchema } from './schema.js';

const adminPostLimiter = createRateLimiter(30, 60_000);

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);
// Rate-limit all POST/PATCH/PUT/DELETE admin operations (30 req/min)
router.use((req, res, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    return adminPostLimiter(req, res, next);
  }
  next();
});

const QUEUE_NAMES = ['email-send', 'drive-sync', 'sheets-sync', 'ai-extraction'] as const;

router.get(
  '/queue-stats',
  validate(queueStatsQuerySchema, 'query'),
  async (_req: Request, res: Response) => {
    try {
      const boss = await getQueue();

      const stats = await Promise.all(
        QUEUE_NAMES.map(async (queueName) => {
          // getQueueSize returns jobs at states BEFORE the given state
          // State order: created < retry < active < completed < cancelled < failed
          const [beforeActive, beforeCompleted, beforeCancelled, beforeFailed] = await Promise.all([
            boss.getQueueSize(queueName, { before: 'active' }),
            boss.getQueueSize(queueName, { before: 'completed' }),
            boss.getQueueSize(queueName, { before: 'cancelled' }),
            boss.getQueueSize(queueName, { before: 'failed' }),
          ]);

          const queued = beforeActive;
          const active = beforeCompleted - beforeActive;
          const completed = beforeCancelled - beforeCompleted;
          const failed = beforeFailed - beforeCancelled;

          return {
            name: queueName,
            queued,
            active,
            completed,
            failed,
          };
        }),
      );

      sendSuccess(res, { queues: stats, timestamp: new Date().toISOString() });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro ao obter estatisticas da fila';
      sendError(res, message, 500);
    }
  },
);

export { router as adminRoutes };
