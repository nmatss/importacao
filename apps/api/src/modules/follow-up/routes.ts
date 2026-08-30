import { Router } from 'express';
import { followUpController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { paramsNumericos } from '../../shared/schemas/params.js';
import { followUpQuerySchema, updateFollowUpSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/', validate(followUpQuerySchema, 'query'), followUpController.getAll);
router.get('/deadlines/li', followUpController.getLiDeadlines);
router.get('/sheet-compare/:processCode', followUpController.compareWithSheet);
router.post('/sync-from-sheet/:processCode', adminMiddleware, followUpController.syncFromSheet);
router.get(
  '/:processId',
  validate(paramsNumericos('processId'), 'params'),
  followUpController.getByProcess,
);
router.put(
  '/:processId',
  validate(paramsNumericos('processId'), 'params'),
  validate(updateFollowUpSchema),
  followUpController.update,
);
router.patch(
  '/:processId/step',
  validate(paramsNumericos('processId'), 'params'),
  followUpController.updateStep,
);

export { router as followUpRoutes };
