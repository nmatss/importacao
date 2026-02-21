import { Router } from 'express';
import { communicationController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createCommunicationSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/', communicationController.list);
router.get('/process/:processId', communicationController.listByProcess);
router.post('/', validate(createCommunicationSchema), communicationController.create);
router.post('/:id/send', communicationController.send);

export { router as communicationRoutes };
