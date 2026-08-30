import { Router } from 'express';
import { settingsController } from './controller.js';
import { authMiddleware, adminMiddleware } from '../../shared/middleware/auth.js';
import { validate } from '../../shared/middleware/validate.js';
import { paramsNumericos } from '../../shared/schemas/params.js';
import { createRateLimiter } from '../../shared/middleware/rate-limit.js';
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
const integrationProbeLimiter = createRateLimiter(5, 60_000);

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
  validate(paramsNumericos('id'), 'params'),
  validate(updateEmailSignatureSchema),
  settingsController.updateSignature,
);
router.delete(
  '/email-signatures/:id',
  validate(paramsNumericos('id'), 'params'),
  settingsController.deleteSignature,
);

// Leitura dos modelos de comunicacao fica aberta a qualquer autenticado: o
// analista precisa deles para escrever. A ESCRITA e administrativa e esta
// registrada depois do adminMiddleware — a tabela e global e o servico nao
// verifica dono, entao um analista podia reescrever ou desativar o modelo que
// outra pessoa usa para falar com KIOM/Fenicia/ISA. (As assinaturas de e-mail
// acima sao por usuario e o servico confere posse; a assimetria era acidental.)
router.get('/communication-templates', settingsController.getCommunicationTemplates);

// Admin-only routes below
router.use(adminMiddleware);

router.post(
  '/communication-templates',
  validate(createCommunicationTemplateSchema),
  settingsController.createCommunicationTemplate,
);
router.put(
  '/communication-templates/:id',
  validate(paramsNumericos('id'), 'params'),
  validate(updateCommunicationTemplateSchema),
  settingsController.updateCommunicationTemplate,
);
router.delete(
  '/communication-templates/:id',
  validate(paramsNumericos('id'), 'params'),
  settingsController.deleteCommunicationTemplate,
);

router.get('/smtp', settingsController.getSmtp);
router.put('/smtp', validate(smtpSettingsSchema), settingsController.saveSmtp);
router.post('/smtp/test', integrationProbeLimiter, settingsController.testSmtp);
router.get('/recipients', settingsController.getRecipients);
router.put('/recipients', validate(recipientSettingsSchema), settingsController.saveRecipients);
router.get('/integrations', settingsController.getIntegrations);
router.put(
  '/integrations',
  validate(integrationSettingsSchema),
  settingsController.saveIntegrations,
);
router.post('/integrations/test-drive', integrationProbeLimiter, settingsController.testDrive);
router.post('/integrations/test-odoo', integrationProbeLimiter, settingsController.testOdoo);

router.get('/', settingsController.getAll);
router.get('/:key', settingsController.get);
router.put('/:key', validate(updateSettingSchema), settingsController.set);

export { router as settingsRoutes };
