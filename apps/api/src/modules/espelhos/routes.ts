import { Router } from 'express';
import { espelhoController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);

// Item-scoped routes (literal prefix, must come first)
router.put('/items/:id', espelhoController.updateItem);
router.delete('/items/:id', espelhoController.deleteItem);

// Espelho-scoped routes with sub-path (must come before bare /:processId)
router.get('/:id/download', espelhoController.download);
router.patch('/:id/sent', espelhoController.markSentToFenicia);

// Process-scoped routes with sub-paths
router.post('/:processId/generate', espelhoController.generate);
router.get('/:processId/items', espelhoController.getItems);
router.post('/:processId/items', espelhoController.addItem);
router.post('/:processId/generate-partial', espelhoController.generatePartial);
router.post('/:processId/generate-li', espelhoController.generatePartial);
router.post('/:processId/send-drive', espelhoController.sendToDrive);
router.post('/:processId/send-fenicia', espelhoController.sendToFenicia);
router.patch('/:processId/items/:id', espelhoController.updateItem);

// Bare param route (must be last to avoid matching other routes)
router.get('/:processId', espelhoController.getEspelho);

export { router as espelhoRoutes };
