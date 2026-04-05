import { Router } from 'express';
import { documentController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { upload } from '../../shared/middleware/upload.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';

const router = Router();

router.use(authMiddleware);

// Upload is expensive (I/O + PDF/Excel parsing) — rate limit
const uploadLimiter = createRateLimiter(20, 60_000);

router.post('/upload', uploadLimiter, upload.single('file'), documentController.upload);
router.get('/process/:processId', documentController.getByProcess);
router.get('/process/:processId/comparison', documentController.comparison);
router.get('/:id', documentController.getById);
router.get('/:id/source', documentController.getSource);
router.post('/:id/reprocess', documentController.reprocess);
router.delete('/:id', documentController.delete);

export { router as documentRoutes };
