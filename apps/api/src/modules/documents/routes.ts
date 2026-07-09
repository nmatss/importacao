import { Router } from 'express';
import { documentController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { upload, validateMagicBytes } from '../../shared/middleware/upload.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';

const router = Router();

router.use(authMiddleware);

// Upload is expensive (I/O + PDF/Excel parsing) — rate limit
const uploadLimiter = createRateLimiter(20, 60_000);
// Reprocessing can invoke AI/OCR and must remain bounded, but is an operational
// action required by analysts after correcting a document classification.
const reprocessLimiter = createRateLimiter(10, 60_000);

router.post(
  '/upload',
  uploadLimiter,
  upload.single('file'),
  validateMagicBytes,
  documentController.upload,
);
router.get('/process/:processId', documentController.getByProcess);
router.get(
  '/process/:processId/extraction-history',
  documentController.getExtractionHistoryByProcess,
);
router.get('/process/:processId/comparison', documentController.comparison);
router.post('/process/:processId/comparison/accept', documentController.acceptComparison);
router.patch('/process/:processId/comparison/field', documentController.editComparisonField);
router.get('/process/:processId/proformas', documentController.proformasAggregate);
router.get('/:id', documentController.getById);
router.get('/:id/source', documentController.getSource);
// Append-only audit trail of archived AI extractions (backlog #12)
router.get('/:id/extraction-history', documentController.getExtractionHistory);
router.get('/:id/file', documentController.getFile);
router.post('/:id/reprocess', reprocessLimiter, documentController.reprocess);
// Re-run cross-document confidence reconciliation for a process (or all).
router.post('/process/:processId/reconcile', adminMiddleware, documentController.reconcileProcess);
router.post('/reconcile-all', adminMiddleware, documentController.reconcileAll);
router.delete('/:id', adminMiddleware, documentController.delete);

export { router as documentRoutes };
