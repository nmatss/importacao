import { Router } from 'express';
import { dashboardController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/overview', dashboardController.getOverview);
router.get('/by-status', dashboardController.getByStatus);
router.get('/by-month', dashboardController.getByMonth);
router.get('/fob-by-brand', dashboardController.getFobByBrand);

export { router as dashboardRoutes };
