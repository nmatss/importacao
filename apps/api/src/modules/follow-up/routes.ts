import { Router } from 'express';
import { followUpController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', followUpController.getAll);
router.get('/deadlines/li', followUpController.getLiDeadlines);
router.get('/sheet-compare/:processCode', followUpController.compareWithSheet);
router.post('/sync-from-sheet/:processCode', followUpController.syncFromSheet);
router.get('/:processId', followUpController.getByProcess);
router.put('/:processId', followUpController.update);

export { router as followUpRoutes };
