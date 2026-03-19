import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { getQueue } from '../../shared/queue/index.js';
import { sendSuccess, sendError } from '../../shared/utils/response.js';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

const QUEUE_NAMES = ['email-send', 'drive-sync', 'sheets-sync', 'ai-extraction'] as const;

router.get('/queue-stats', async (_req: Request, res: Response) => {
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
});

export { router as adminRoutes };
