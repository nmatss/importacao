import { Router } from 'express';
import { espelhoController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { paramsNumericos } from '../../shared/schemas/params.js';
import { updateEspelhoItemSchema, addEspelhoItemSchema } from './schema.js';

const router = Router();

router.use(authMiddleware);

// Item-scoped routes (literal prefix, must come first)
router.put(
  '/items/:id',
  validate(paramsNumericos('id'), 'params'),
  validate(updateEspelhoItemSchema),
  espelhoController.updateItem,
);
router.delete(
  '/items/:id',
  adminMiddleware,
  validate(paramsNumericos('id'), 'params'),
  espelhoController.deleteItem,
);

// Espelho-scoped routes with sub-path (must come before bare /:processId)
router.get('/:id/download', validate(paramsNumericos('id'), 'params'), espelhoController.download);
router.patch(
  '/:id/sent',
  adminMiddleware,
  validate(paramsNumericos('id'), 'params'),
  espelhoController.markSentToFenicia,
);

// Process-scoped routes with sub-paths
router.post(
  '/:processId/generate',
  validate(paramsNumericos('processId'), 'params'),
  espelhoController.generate,
);
router.get(
  '/:processId/items',
  validate(paramsNumericos('processId'), 'params'),
  espelhoController.getItems,
);
router.post(
  '/:processId/items',
  validate(paramsNumericos('processId'), 'params'),
  validate(addEspelhoItemSchema),
  espelhoController.addItem,
);
router.post(
  '/:processId/generate-partial',
  validate(paramsNumericos('processId'), 'params'),
  espelhoController.generatePartial,
);
router.post(
  '/:processId/generate-li',
  validate(paramsNumericos('processId'), 'params'),
  espelhoController.generatePartial,
);
router.post(
  '/:processId/send-drive',
  validate(paramsNumericos('processId'), 'params'),
  espelhoController.sendToDrive,
);
router.post(
  '/:processId/send-fenicia',
  adminMiddleware,
  validate(paramsNumericos('processId'), 'params'),
  espelhoController.sendToFenicia,
);
router.patch(
  '/:processId/items/:id',
  validate(paramsNumericos('processId', 'id'), 'params'),
  validate(updateEspelhoItemSchema),
  espelhoController.updateItem,
);

// Bare param route (must be last to avoid matching other routes)
router.get(
  '/:processId',
  validate(paramsNumericos('processId'), 'params'),
  espelhoController.getEspelho,
);

export { router as espelhoRoutes };
