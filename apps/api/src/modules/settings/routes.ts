import { Router } from 'express';
import { settingsController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/', settingsController.getAll);
router.get('/:key', settingsController.get);
router.put('/:key', settingsController.set);

export { router as settingsRoutes };
