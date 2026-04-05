import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { emailIngestionController } from './controller.js';
import {
  emailLogsQuerySchema,
  triggerCheckSchema,
  historyScanSchema,
  logIdParamSchema,
} from './schema.js';

const triggerPollLimiter = createRateLimiter(5, 60_000);

const router = Router();
router.use(authMiddleware);

router.get('/status', emailIngestionController.getStatus);
router.get('/logs', validate(emailLogsQuerySchema, 'query'), emailIngestionController.getLogs);
router.post(
  '/trigger',
  triggerPollLimiter,
  validate(triggerCheckSchema),
  emailIngestionController.triggerCheck,
);
router.post('/history-scan', validate(historyScanSchema), emailIngestionController.historyScan);
router.post(
  '/reprocess/:logId',
  validate(logIdParamSchema, 'params'),
  emailIngestionController.reprocess,
);

export { router as emailIngestionRoutes };
