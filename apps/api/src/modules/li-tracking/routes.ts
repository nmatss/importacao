import { Router } from 'express';
import { liTrackingController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createLiTrackingSchema, updateLiTrackingSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/', liTrackingController.getAll);
router.get('/stats', liTrackingController.getStats);
router.get('/process/:processCode', liTrackingController.getByProcess);
router.post('/', validate(createLiTrackingSchema), liTrackingController.create);
router.put('/:id', validate(updateLiTrackingSchema), liTrackingController.update);
router.delete('/:id', liTrackingController.delete);

export { router as liTrackingRoutes };
