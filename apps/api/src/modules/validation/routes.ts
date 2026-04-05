import { Router } from 'express';
import { validationController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { processIdParamSchema, resultIdParamSchema, updateCorrectionSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.post(
  '/:processId/run',
  validate(processIdParamSchema, 'params'),
  validationController.runAllChecks,
);
router.get(
  '/:processId',
  validate(processIdParamSchema, 'params'),
  validationController.getResults,
);
router.get(
  '/:processId/report',
  validate(processIdParamSchema, 'params'),
  validationController.getReport,
);
router.patch(
  '/results/:id/resolve',
  validate(resultIdParamSchema, 'params'),
  validationController.resolveManually,
);
router.post(
  '/:processId/anomalies',
  validate(processIdParamSchema, 'params'),
  validationController.runAnomalyDetection,
);
router.post(
  '/:processId/correction-draft',
  validate(processIdParamSchema, 'params'),
  validationController.generateCorrectionDraft,
);
router.get(
  '/:processId/corrections',
  validate(processIdParamSchema, 'params'),
  validationController.getCorrections,
);
router.patch(
  '/:processId/corrections',
  validate(processIdParamSchema, 'params'),
  validate(updateCorrectionSchema),
  validationController.updateCorrection,
);

export { router as validationRoutes };
