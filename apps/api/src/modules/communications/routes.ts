import { Router } from 'express';
import { communicationController } from './controller.js';
import { authMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
import {
  communicationIdParamSchema,
  communicationListQuerySchema,
  communicationProcessIdParamSchema,
  communicationProcessListQuerySchema,
  createCommunicationSchema,
  driveFilesQuerySchema,
  driveImportSchema,
  sendCommunicationSchema,
  updateDraftSchema,
} from './schema.js';

const router = Router();
const sendLimiter = createRateLimiter(10, 60_000); // 10 sends per minute
// Importar do Drive faz download + gravacao em disco + pipeline de documento:
// custo comparavel ao de um upload, entao usa o mesmo teto do upload multipart.
const driveImportLimiter = createRateLimiter(20, 60_000);

router.use(authMiddleware);

router.get('/', validate(communicationListQuerySchema, 'query'), communicationController.list);
router.get(
  '/process/:processId',
  validate(communicationProcessIdParamSchema, 'params'),
  validate(communicationProcessListQuerySchema, 'query'),
  communicationController.listByProcess,
);
router.get(
  '/drive/files',
  validate(driveFilesQuerySchema, 'query'),
  communicationController.listDriveFiles,
);
router.post(
  '/drive/import',
  driveImportLimiter,
  validate(driveImportSchema),
  communicationController.importDriveFile,
);
router.post('/', validate(createCommunicationSchema), communicationController.create);
router.post(
  '/:id/send',
  validate(communicationIdParamSchema, 'params'),
  validate(sendCommunicationSchema),
  sendLimiter,
  communicationController.send,
);
router.patch(
  '/:id/draft',
  validate(communicationIdParamSchema, 'params'),
  validate(updateDraftSchema),
  communicationController.updateDraft,
);

export { router as communicationRoutes };
