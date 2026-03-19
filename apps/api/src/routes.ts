import { Router } from 'express';
import { authRoutes } from './modules/auth/routes.js';
import { processRoutes } from './modules/processes/routes.js';
import { documentRoutes } from './modules/documents/routes.js';
import { validationRoutes } from './modules/validation/routes.js';
import { espelhoRoutes } from './modules/espelhos/routes.js';
import { currencyExchangeRoutes } from './modules/currency-exchange/routes.js';
import { followUpRoutes } from './modules/follow-up/routes.js';
import { communicationRoutes } from './modules/communications/routes.js';
import { alertRoutes } from './modules/alerts/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { aiRoutes } from './modules/ai/routes.js';
import { emailIngestionRoutes } from './modules/email-ingestion/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { liTrackingRoutes } from './modules/li-tracking/routes.js';
import { adminRoutes } from './modules/admin/routes.js';

const apiRouter = Router();

// Public health check (no auth required)
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

apiRouter.use('/auth', authRoutes);
apiRouter.use('/processes', processRoutes);
apiRouter.use('/documents', documentRoutes);
apiRouter.use('/validation', validationRoutes);
apiRouter.use('/espelhos', espelhoRoutes);
apiRouter.use('/currency-exchange', currencyExchangeRoutes);
apiRouter.use('/follow-up', followUpRoutes);
apiRouter.use('/communications', communicationRoutes);
apiRouter.use('/alerts', alertRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/ai', aiRoutes);
apiRouter.use('/email-ingestion', emailIngestionRoutes);
apiRouter.use('/audit', auditRoutes);
apiRouter.use('/li-tracking', liTrackingRoutes);
apiRouter.use('/admin', adminRoutes);

export { apiRouter };
