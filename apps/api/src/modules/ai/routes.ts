import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { extractDocument, detectAnomalies, generateEmailDraft, validateNcm } from './controller.js';

const router = Router();

router.use(authMiddleware);
router.use(createRateLimiter(30, 60 * 1000));

router.post('/extract', extractDocument);
router.post('/anomalies', detectAnomalies);
router.post('/email-draft', generateEmailDraft);
router.post('/validate-ncm', validateNcm);

export { router as aiRoutes };
