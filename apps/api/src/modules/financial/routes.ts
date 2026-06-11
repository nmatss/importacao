import { Router } from 'express';
import { financialController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

// Montado em /api/processes (junto com processRoutes):
//   GET  /api/processes/:id/financials            → snapshot on-demand
//   POST /api/processes/:id/financials/recompute  → persiste numerário
const router = Router();

router.use(authMiddleware);

router.get('/:id/financials', financialController.getFinancials);
router.post('/:id/financials/recompute', financialController.recompute);

export { router as financialRoutes };
