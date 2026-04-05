import { Router } from 'express';
import { auditController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { auditLogsQuerySchema } from './schema.js';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/logs', validate(auditLogsQuerySchema, 'query'), auditController.getLogs);

export { router as auditRoutes };
