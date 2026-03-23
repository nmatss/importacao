import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { emailIngestionController } from './controller.js';

const router = Router();
router.use(authMiddleware);

router.get('/status', emailIngestionController.getStatus);
router.get('/logs', emailIngestionController.getLogs);
router.post('/trigger', emailIngestionController.triggerCheck);
router.post('/history-scan', emailIngestionController.historyScan);
router.post('/reprocess/:logId', emailIngestionController.reprocess);

export { router as emailIngestionRoutes };
