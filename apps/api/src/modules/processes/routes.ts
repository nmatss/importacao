import { Router } from 'express';
import { processController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createProcessSchema, updateProcessSchema, updateStatusSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/', processController.list);
router.get('/stats', processController.getStats);
router.get('/:id', processController.getById);
router.post('/', validate(createProcessSchema), processController.create);
router.put('/:id', validate(updateProcessSchema), processController.update);
router.patch('/:id/status', validate(updateStatusSchema), processController.updateStatus);
router.delete('/:id', processController.delete);

export { router as processRoutes };
