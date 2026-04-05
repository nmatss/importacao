import { Router } from 'express';
import { dashboardController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { dateRangeQuerySchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/overview', validate(dateRangeQuerySchema, 'query'), dashboardController.getOverview);
router.get('/by-status', dashboardController.getByStatus);
router.get('/by-month', dashboardController.getByMonth);
router.get('/fob-by-brand', dashboardController.getFobByBrand);
router.get('/sla', dashboardController.getSla);
router.get(
  '/executive',
  validate(dateRangeQuerySchema, 'query'),
  dashboardController.getExecutiveKpis,
);
router.get(
  '/executive/timeline',
  validate(dateRangeQuerySchema, 'query'),
  dashboardController.getProcessingTimeline,
);

export { router as dashboardRoutes };
