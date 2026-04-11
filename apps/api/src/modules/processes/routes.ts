import { Router } from 'express';
import { processController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import {
  createProcessSchema,
  createFromPreConsSchema,
  updateProcessSchema,
  updateStatusSchema,
  updateLogisticStatusSchema,
} from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/', processController.list);
router.get('/stats', processController.getStats);
router.get('/:id', processController.getById);
router.get('/:id/events', processController.getEvents);
router.post('/', validate(createProcessSchema), processController.create);
router.post(
  '/from-pre-cons',
  validate(createFromPreConsSchema),
  processController.createFromPreCons,
);
router.put('/:id', validate(updateProcessSchema), processController.update);
router.patch('/:id/status', validate(updateStatusSchema), processController.updateStatus);
router.patch(
  '/:id/logistic-status',
  validate(updateLogisticStatusSchema),
  processController.updateLogisticStatus,
);
router.delete('/:id', processController.delete);

export { router as processRoutes };
