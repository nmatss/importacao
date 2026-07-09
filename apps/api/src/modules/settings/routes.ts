import { Router } from 'express';
import { settingsController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import {
  updateSettingSchema,
  smtpSettingsSchema,
  integrationSettingsSchema,
  recipientSettingsSchema,
  createEmailSignatureSchema,
  updateEmailSignatureSchema,
  createCommunicationTemplateSchema,
  updateCommunicationTemplateSchema,
} from './schema.js';

const router = Router();

router.use(authMiddleware);

// Email signatures — accessible by all authenticated users (before adminMiddleware)
router.get('/email-signatures', settingsController.getSignatures);
router.post(
  '/email-signatures',
  validate(createEmailSignatureSchema),
  settingsController.createSignature,
);
router.put(
  '/email-signatures/:id',
  validate(updateEmailSignatureSchema),
  settingsController.updateSignature,
);
router.delete('/email-signatures/:id', settingsController.deleteSignature);

router.get('/communication-templates', settingsController.getCommunicationTemplates);
router.post(
  '/communication-templates',
  validate(createCommunicationTemplateSchema),
  settingsController.createCommunicationTemplate,
);
router.put(
  '/communication-templates/:id',
  validate(updateCommunicationTemplateSchema),
  settingsController.updateCommunicationTemplate,
);
router.delete('/communication-templates/:id', settingsController.deleteCommunicationTemplate);

// Admin-only routes below
router.use(adminMiddleware);

router.get('/smtp', settingsController.getSmtp);
router.put('/smtp', validate(smtpSettingsSchema), settingsController.saveSmtp);
router.get('/recipients', settingsController.getRecipients);
router.put('/recipients', validate(recipientSettingsSchema), settingsController.saveRecipients);
router.get('/integrations', settingsController.getIntegrations);
router.put(
  '/integrations',
  validate(integrationSettingsSchema),
  settingsController.saveIntegrations,
);
router.post('/integrations/test-drive', settingsController.testDrive);
router.post('/integrations/test-odoo', settingsController.testOdoo);

router.get('/', settingsController.getAll);
router.get('/:key', settingsController.get);
router.put('/:key', validate(updateSettingSchema), settingsController.set);

export { router as settingsRoutes };
