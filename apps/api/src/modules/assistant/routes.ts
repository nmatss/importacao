import { Router } from 'express';
import { assistantController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { validate } from '../../shared/middleware/validate.js';
import { assistantQuerySchema } from './schema.js';

const router = Router();

router.use(authMiddleware);
router.use(createRateLimiter(20, 60_000));

router.post('/query', validate(assistantQuerySchema), assistantController.query);

export { router as assistantRoutes };
