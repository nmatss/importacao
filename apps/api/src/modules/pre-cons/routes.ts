import { Router } from 'express';
import { preConsController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { upload } from '../../shared/middleware/upload.js';
import { validate } from '../../shared/middleware/validate.js';
import { getPreConsItemsSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

// Upload and sync Pre-Cons XLSX (admin only)
router.post('/sync', adminMiddleware, upload.single('file'), preConsController.sync);

// List Pre-Cons items (with optional processCode filter)
router.get('/items', validate(getPreConsItemsSchema, 'query'), preConsController.getItems);

// Get Pre-Cons items for a specific process
router.get('/process/:processCode', preConsController.getByProcess);

// Get distinct sheet names for filter
router.get('/sheets', preConsController.getSheets);

// Get divergences between Pre-Cons and system data (admin only)
router.get('/divergences', adminMiddleware, preConsController.getDivergences);

// Get sync history logs (admin only)
router.get('/sync-logs', adminMiddleware, preConsController.getSyncLogs);

export { router as preConsRoutes };
