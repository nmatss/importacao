import { Router } from 'express';
import { preConsController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { upload } from '../../shared/middleware/upload.js';

const router = Router();

router.use(authMiddleware);

// Upload and sync Pre-Cons XLSX
router.post('/sync', upload.single('file'), preConsController.sync);

// List Pre-Cons items (with optional processCode filter)
router.get('/items', preConsController.getItems);

// Get Pre-Cons items for a specific process
router.get('/process/:processCode', preConsController.getByProcess);

// Get divergences between Pre-Cons and system data
router.get('/divergences', preConsController.getDivergences);

// Get sync history logs
router.get('/sync-logs', preConsController.getSyncLogs);

export { router as preConsRoutes };
