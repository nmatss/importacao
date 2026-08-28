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
  processFilterSchema,
  createCustomStageSchema,
  updateCustomStageSchema,
  createOperationalRecordSchema,
  updateOperationalRecordSchema,
  updateDraftBlChecklistSchema,
} from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/', validate(processFilterSchema, 'query'), processController.list);
router.get('/stats', processController.getStats);
router.get('/:id', processController.getById);
router.get('/:id/events', processController.getEvents);
router.get('/:id/draft-bl-checklist', processController.getDraftBlChecklist);
router.patch(
  '/:id/draft-bl-checklist',
  validate(updateDraftBlChecklistSchema),
  processController.updateDraftBlChecklist,
);
router.get('/:id/custom-stages', processController.listCustomStages);
router.post(
  '/:id/custom-stages',
  validate(createCustomStageSchema),
  processController.createCustomStage,
);
router.put(
  '/:id/custom-stages/:stageId',
  validate(updateCustomStageSchema),
  processController.updateCustomStage,
);
router.delete('/:id/custom-stages/:stageId', processController.deleteCustomStage);
router.get('/:id/operational-records', processController.listOperationalRecords);
router.post(
  '/:id/operational-records',
  validate(createOperationalRecordSchema),
  processController.createOperationalRecord,
);
router.put(
  '/:id/operational-records/:recordId',
  validate(updateOperationalRecordSchema),
  processController.updateOperationalRecord,
);
router.delete('/:id/operational-records/:recordId', processController.deleteOperationalRecord);
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
