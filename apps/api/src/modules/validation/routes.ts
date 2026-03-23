import { Router } from 'express';
import { validationController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.post('/:processId/run', validationController.runAllChecks);
router.get('/:processId', validationController.getResults);
router.get('/:processId/report', validationController.getReport);
router.patch('/results/:id/resolve', validationController.resolveManually);
router.post('/:processId/anomalies', validationController.runAnomalyDetection);
router.post('/:processId/correction-draft', validationController.generateCorrectionDraft);
router.get('/:processId/corrections', validationController.getCorrections);
router.patch('/:processId/corrections', validationController.updateCorrection);

export { router as validationRoutes };
