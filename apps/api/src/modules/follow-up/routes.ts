import { Router } from 'express';
import { followUpController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { updateFollowUpSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/', followUpController.getAll);
router.get('/deadlines/li', followUpController.getLiDeadlines);
router.get('/sheet-compare/:processCode', followUpController.compareWithSheet);
router.post('/sync-from-sheet/:processCode', followUpController.syncFromSheet);
router.get('/:processId', followUpController.getByProcess);
router.put('/:processId', validate(updateFollowUpSchema), followUpController.update);
router.patch('/:processId/step', followUpController.updateStep);

export { router as followUpRoutes };
