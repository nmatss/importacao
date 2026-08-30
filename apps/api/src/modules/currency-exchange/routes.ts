import { Router } from 'express';
import { currencyExchangeController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { paramsNumericos } from '../../shared/schemas/params.js';
import { createCurrencyExchangeSchema, updateCurrencyExchangeSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

router.get(
  '/process/:processId',
  validate(paramsNumericos('processId'), 'params'),
  currencyExchangeController.list,
);
router.get(
  '/process/:processId/totals',
  validate(paramsNumericos('processId'), 'params'),
  currencyExchangeController.getByProcess,
);
router.post('/', validate(createCurrencyExchangeSchema), currencyExchangeController.create);
router.put(
  '/:id',
  validate(paramsNumericos('id'), 'params'),
  validate(updateCurrencyExchangeSchema),
  currencyExchangeController.update,
);
router.delete('/:id', validate(paramsNumericos('id'), 'params'), currencyExchangeController.delete);

export { router as currencyExchangeRoutes };
