import { Router } from 'express';
import { currencyExchangeController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createCurrencyExchangeSchema, updateCurrencyExchangeSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get('/process/:processId', currencyExchangeController.list);
router.get('/process/:processId/totals', currencyExchangeController.getByProcess);
router.post('/', validate(createCurrencyExchangeSchema), currencyExchangeController.create);
router.put('/:id', validate(updateCurrencyExchangeSchema), currencyExchangeController.update);
router.delete('/:id', currencyExchangeController.delete);

export { router as currencyExchangeRoutes };
