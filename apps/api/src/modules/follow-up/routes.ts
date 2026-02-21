import { Router } from 'express';
import { followUpController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', followUpController.getAll);
router.get('/deadlines/li', followUpController.getLiDeadlines);
router.get('/:processId', followUpController.getByProcess);
router.put('/:processId', followUpController.update);

export { router as followUpRoutes };
