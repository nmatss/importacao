import { Router } from 'express';
import { financialController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { validate } from '../../shared/middleware/validate.js';
import { paramsNumericos } from '../../shared/schemas/params.js';

// Montado em /api/processes (junto com processRoutes):
//   GET  /api/processes/:id/financials            → snapshot on-demand
//   POST /api/processes/:id/financials/recompute  → persiste numerário
const router = Router();

router.use(authMiddleware);

const financialLimiter = createRateLimiter(30, 60_000);

router.get(
  '/:id/financials',
  validate(paramsNumericos('id'), 'params'),
  financialLimiter,
  financialController.getFinancials,
);
router.post(
  '/:id/financials/recompute',
  validate(paramsNumericos('id'), 'params'),
  financialLimiter,
  financialController.recompute,
);

export { router as financialRoutes };
