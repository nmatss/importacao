import { Router } from 'express';
import { auditController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/logs', auditController.getLogs);

export { router as auditRoutes };
