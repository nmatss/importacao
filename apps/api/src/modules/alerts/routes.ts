import { Router } from 'express';
import { alertController } from './controller.js';
import { adminMiddleware, authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { paramsNumericos } from '../../shared/schemas/params.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import { alertsQuerySchema, createAlertSchema } from './schema.js';

// `create` publica no espaco corporativo do Google Chat. Só com
// `authMiddleware`, qualquer conta autenticada postava mensagem arbitraria no
// canal, sem limite.
const createAlertLimiter = createRateLimiter(10, 60_000);

const router = Router();

router.use(authMiddleware);

router.get('/', validate(alertsQuerySchema, 'query'), alertController.list);
router.post(
  '/',
  createAlertLimiter,
  adminMiddleware,
  validate(createAlertSchema),
  alertController.create,
);
router.patch(
  '/:id/acknowledge',
  validate(paramsNumericos('id'), 'params'),
  alertController.acknowledge,
);

export { router as alertRoutes };
