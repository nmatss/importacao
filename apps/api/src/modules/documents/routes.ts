import { Router, type NextFunction, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { documents, importProcesses } from '../../shared/database/schema.js';
import { buildRegistroComparison } from './registro-comparison.js';
import { sourceSelectionSchema, selectAttachedSources } from './source-selection.js';
import { documentController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { upload, validateMagicBytes } from '../../shared/middleware/upload.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { getDocumentSourcePolicy, isManualDocumentUploadEnabled } from './source-policy.js';
import { sendError, sendSuccess } from '../../shared/utils/response.js';
import { validate } from '../../shared/middleware/validate.js';
import { paramsNumericos } from '../../shared/schemas/params.js';
import { deleteDocumentSchema } from './schema.js';

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
// Status da varredura do Drive para o processo (DRV-08). A tela mostra "o
// Drive olhou e nao achou nada" em vez de deixar o processo vazio sem motivo.
router.get(
  '/process/:processId/drive-status',
  validate(paramsNumericos('processId'), 'params'),
  documentController.driveStatus,
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
router.get(
  '/process/:processId/registro-comparison',
  validate(paramsNumericos('processId'), 'params'),
  async (req, res, next) => {
    try {
      const processId = Number(req.params.processId);
      const selection = sourceSelectionSchema.safeParse(req.query);
      if (!selection.success) return sendError(res, 'Seleção de documentos inválida.', 400);
      const [process] = await db
        .select({ id: importProcesses.id, processCode: importProcesses.processCode })
        .from(importProcesses)
        .where(eq(importProcesses.id, processId))
        .limit(1);
      if (!process) return sendError(res, 'Processo não encontrado', 404);
      const rows = await db.select().from(documents).where(eq(documents.processId, processId));
      return sendSuccess(
        res,
        buildRegistroComparison(
          processId,
          selectAttachedSources(rows, selection.data),
          process.processCode,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
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
// Excluir documento voltou a ser acao de ANALISTA (D8, reuniao 11/09: rascunho
// da DUIMP anexado no processo errado e so o admin conseguia remover — "voces
// estao sem acesso, eu vou liberar"). As salvaguardas que substituem o
// `adminMiddleware` do hardening de junho: motivo obrigatorio (schema abaixo),
// audit com a origem do arquivo, evento no historico do processo, tombstone
// contra reimportacao pelo Drive e o bloqueio 423 em processo travado, que
// continua valendo dentro do service.
router.delete(
  '/:id',
  validate(paramsNumericos('id'), 'params'),
  validate(deleteDocumentSchema),
  documentController.delete,
);

export { router as documentRoutes };
