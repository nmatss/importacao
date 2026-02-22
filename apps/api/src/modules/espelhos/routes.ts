import { Router } from 'express';
import { espelhoController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';

const router = Router();

router.use(authMiddleware);

// Process-scoped routes
router.post('/:processId/generate', espelhoController.generate);
router.get('/:processId', espelhoController.getEspelho);
router.get('/:processId/items', espelhoController.getItems);
router.post('/:processId/items', espelhoController.addItem);
router.post('/:processId/generate-partial', espelhoController.generatePartial);
router.post('/:processId/generate-li', espelhoController.generatePartial);
router.post('/:processId/send-drive', espelhoController.sendToDrive);
router.post('/:processId/send-fenicia', espelhoController.sendToFenicia);
router.patch('/:processId/items/:id', espelhoController.updateItem);

// Item-scoped routes
router.put('/items/:id', espelhoController.updateItem);
router.delete('/items/:id', espelhoController.deleteItem);

// Espelho-scoped routes
router.get('/:id/download', espelhoController.download);
router.patch('/:id/sent', espelhoController.markSentToFenicia);

export { router as espelhoRoutes };
