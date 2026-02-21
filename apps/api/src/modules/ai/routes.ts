import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { extractDocument, detectAnomalies, generateEmailDraft, validateNcm } from './controller.js';

const router = Router();

router.use(authMiddleware);

router.post('/extract', extractDocument);
router.post('/anomalies', detectAnomalies);
router.post('/email-draft', generateEmailDraft);
router.post('/validate-ncm', validateNcm);

export { router as aiRoutes };
