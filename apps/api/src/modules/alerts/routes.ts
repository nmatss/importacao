import { Router } from 'express';
import { alertController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', alertController.list);
router.post('/', alertController.create);
router.patch('/:id/acknowledge', alertController.acknowledge);

export { router as alertRoutes };
