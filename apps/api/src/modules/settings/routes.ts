import { Router } from 'express';
import { settingsController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/smtp', settingsController.getSmtp);
router.put('/smtp', settingsController.saveSmtp);
router.get('/integrations', settingsController.getIntegrations);
router.put('/integrations', settingsController.saveIntegrations);
router.post('/integrations/test-drive', settingsController.testDrive);
router.post('/integrations/test-odoo', settingsController.testOdoo);

router.get('/', settingsController.getAll);
router.get('/:key', settingsController.get);
router.put('/:key', settingsController.set);

export { router as settingsRoutes };
