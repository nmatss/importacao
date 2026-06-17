import { Router } from 'express';
import { processController } from './controller.js';
import { validationController } from '../validation/controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import {
  createProcessSchema,
  createFromPreConsSchema,
  updateProcessSchema,
  updateStatusSchema,
  updateLogisticStatusSchema,
  renameProcessSchema,
  lockProcessSchema,
} from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/', processController.list);
router.get('/stats', processController.getStats);
router.get('/:id', processController.getById);
router.get('/:id/events', processController.getEvents);
// Append-only audit trail of past validation runs (backlog #12)
router.get('/:id/validation-history', validationController.getValidationHistory);
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
// Privileged: lock/unlock/rename change process identity & auto-edit posture
// and must be admin-only (security audit 2026-05-22).
router.patch(
  '/:id/rename',
  adminMiddleware,
  validate(renameProcessSchema),
  processController.rename,
);
router.post('/:id/lock', adminMiddleware, validate(lockProcessSchema), processController.lock);
router.post('/:id/unlock', adminMiddleware, processController.unlock);
router.delete('/:id', adminMiddleware, processController.delete);

export { router as processRoutes };
