import { Router } from 'express';
import { dashboardController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);

// Recorte por periodo nao e suportado por estes endpoints: os controllers de
// /overview, /executive e /executive/timeline ignoram a query e chamam o
// service sem argumento. Validar startDate/endDate aqui so anunciava um filtro
// inexistente.
router.get('/overview', dashboardController.getOverview);
router.get('/by-status', dashboardController.getByStatus);
router.get('/by-month', dashboardController.getByMonth);
router.get('/fob-by-brand', dashboardController.getFobByBrand);
router.get('/sla', dashboardController.getSla);
router.get('/executive', dashboardController.getExecutiveKpis);
router.get('/executive/timeline', dashboardController.getProcessingTimeline);

export { router as dashboardRoutes };
