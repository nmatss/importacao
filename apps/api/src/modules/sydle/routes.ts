import { Router } from 'express';
import { sydleController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { sydleReportQuerySchema, syncRunsQuerySchema } from './schema.js';

const router = Router();
const syncLimiter = createRateLimiter(5, 60_000);

router.use(authMiddleware);

router.get('/config', adminMiddleware, sydleController.config);
router.get(
  '/payments-report',
  validate(sydleReportQuerySchema, 'query'),
  sydleController.listReport,
);
router.get(
  '/payments-report/summary',
  validate(sydleReportQuerySchema, 'query'),
  sydleController.summary,
);
router.get(
  '/payments-report/export.csv',
  validate(sydleReportQuerySchema, 'query'),
  sydleController.exportCsv,
);
router.get(
  '/payments-report/export.xlsx',
  validate(sydleReportQuerySchema, 'query'),
  sydleController.exportXlsx,
);
router.get(
  '/payments-report/export.pdf',
  validate(sydleReportQuerySchema, 'query'),
  sydleController.exportPdf,
);
// Single-payment detail. Registered AFTER the literal /summary and /export.*
// routes so the ":id" param cannot capture them.
router.get('/payments-report/:id', sydleController.getById);
router.get(
  '/sync-runs',
  adminMiddleware,
  validate(syncRunsQuerySchema, 'query'),
  sydleController.syncRuns,
);
router.post('/sync-now', adminMiddleware, syncLimiter, sydleController.syncNow);

export { router as sydleRoutes };
