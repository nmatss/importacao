import { Router } from 'express';
import { communicationController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { createCommunicationSchema, updateDraftSchema } from './schema.js';

const router = Router();
const sendLimiter = createRateLimiter(10, 60_000); // 10 sends per minute

router.use(authMiddleware);

router.get('/', communicationController.list);
router.get('/process/:processId', communicationController.listByProcess);
router.post('/', validate(createCommunicationSchema), communicationController.create);
router.post('/:id/send', sendLimiter, communicationController.send);
router.patch('/:id/draft', validate(updateDraftSchema), communicationController.updateDraft);

export { router as communicationRoutes };
