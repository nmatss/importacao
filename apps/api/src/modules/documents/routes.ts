import { Router, type NextFunction, type Request, type Response } from 'express';
import { documentController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { upload, validateMagicBytes } from '../../shared/middleware/upload.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { getDocumentSourcePolicy, isManualDocumentUploadEnabled } from './source-policy.js';
import { sendError, sendSuccess } from '../../shared/utils/response.js';
import { validate } from '../../shared/middleware/validate.js';
import { paramsNumericos } from '../../shared/schemas/params.js';

const router = Router();

router.use(authMiddleware);

// Upload is expensive (I/O + PDF/Excel parsing) — rate limit
const uploadLimiter = createRateLimiter(20, 60_000);
// Reprocessing can invoke AI/OCR and must remain bounded, but is an operational
// action required by analysts after correcting a document classification.
const reprocessLimiter = createRateLimiter(10, 60_000);

export function requireManualDocumentUpload(_req: Request, res: Response, next: NextFunction) {
  if (!isManualDocumentUploadEnabled()) {
    return sendError(
      res,
      'Upload manual desativado: nesta fase, inclua o arquivo na pasta do processo no Google Drive.',
      409,
    );
  }
  next();
}

router.get('/source-policy', (_req, res) => sendSuccess(res, getDocumentSourcePolicy()));

router.post(
  '/upload',
  // Gate before Multer: a rejected request must not create a temporary file.
  requireManualDocumentUpload,
  uploadLimiter,
  upload.single('file'),
  validateMagicBytes,
  documentController.upload,
);
router.get(
  '/process/:processId',
  validate(paramsNumericos('processId'), 'params'),
  documentController.getByProcess,
);
router.get(
  '/process/:processId/extraction-history',
  validate(paramsNumericos('processId'), 'params'),
  documentController.getExtractionHistoryByProcess,
);
router.get(
  '/process/:processId/comparison',
  validate(paramsNumericos('processId'), 'params'),
  documentController.comparison,
);
router.post(
  '/process/:processId/comparison/accept',
  validate(paramsNumericos('processId'), 'params'),
  documentController.acceptComparison,
);
router.patch(
  '/process/:processId/comparison/field',
  validate(paramsNumericos('processId'), 'params'),
  documentController.editComparisonField,
);
// Reverte a edicao manual e devolve a celula ao valor extraido (auditado).
router.delete(
  '/process/:processId/comparison/field',
  validate(paramsNumericos('processId'), 'params'),
  documentController.removeComparisonField,
);
router.get(
  '/process/:processId/proformas',
  validate(paramsNumericos('processId'), 'params'),
  documentController.proformasAggregate,
);
router.get('/:id', validate(paramsNumericos('id'), 'params'), documentController.getById);
router.get('/:id/source', validate(paramsNumericos('id'), 'params'), documentController.getSource);
// Append-only audit trail of archived AI extractions (backlog #12)
router.get(
  '/:id/extraction-history',
  validate(paramsNumericos('id'), 'params'),
  documentController.getExtractionHistory,
);
router.get(
  '/:id/extraction-evidence',
  validate(paramsNumericos('id'), 'params'),
  documentController.getExtractionEvidence,
);
router.get('/:id/file', validate(paramsNumericos('id'), 'params'), documentController.getFile);
router.post(
  '/:id/reprocess',
  validate(paramsNumericos('id'), 'params'),
  reprocessLimiter,
  documentController.reprocess,
);
router.patch(
  '/:id/classification',
  validate(paramsNumericos('id'), 'params'),
  reprocessLimiter,
  documentController.reclassify,
);
// Re-run cross-document confidence reconciliation for a process (or all).
router.post(
  '/process/:processId/reconcile',
  adminMiddleware,
  validate(paramsNumericos('processId'), 'params'),
  documentController.reconcileProcess,
);
router.post('/reconcile-all', adminMiddleware, documentController.reconcileAll);
router.delete(
  '/:id',
  adminMiddleware,
  validate(paramsNumericos('id'), 'params'),
  documentController.delete,
);

export { router as documentRoutes };
