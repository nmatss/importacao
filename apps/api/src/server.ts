// Initialize Sentry before anything else (captures import errors)
import { initSentry } from './shared/observability/sentry.js';
initSentry();

import { getEnv } from './shared/config/env.js';
import { app } from './app.js';
import { logger } from './shared/utils/logger.js';
import { startScheduler } from './jobs/scheduler.js';
import { initQueue, stopQueue } from './shared/queue/index.js';
import { registerWorkers } from './shared/queue/workers.js';
import { initCache, stopCache } from './shared/cache/redis.js';

// Validate env vars at startup — fail-fast if invalid
const env = getEnv();

const PORT = env.API_PORT;

// ── Startup checks for critical environment variables ──────────────
function checkEnvVars() {
  const warnings: string[] = [];
  const aiProvider = env.AI_PROVIDER;

  if (aiProvider === 'ialocal' && (!env.IA_LOCAL_BASE_URL || !env.IA_LOCAL_API_KEY)) {
    warnings.push(
      'IA_LOCAL não configurado — defina IA_LOCAL_BASE_URL e IA_LOCAL_API_KEY para extração local',
    );
  }

  if (
    aiProvider === 'openrouter' &&
    (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === 'your-openrouter-api-key')
  ) {
    warnings.push(
      'OPENROUTER_API_KEY não configurada — extração IA, anomalias e geração de emails com IA não funcionarão',
    );
  }
  if (
    !process.env.SMTP_HOST ||
    (process.env.SMTP_HOST === 'smtp.gmail.com' && process.env.SMTP_USER === 'your-email@gmail.com')
  ) {
    warnings.push('SMTP não configurado — envio de emails não funcionará');
  }
  if (!process.env.KIOM_EMAIL) {
    warnings.push('KIOM_EMAIL não definido — emails de correção para KIOM não terão destinatário');
  }
  if (!process.env.FENICIA_EMAIL) {
    warnings.push('FENICIA_EMAIL não definido — emails para Fenicia não terão destinatário');
  }
  if (!process.env.ISA_EMAIL) {
    warnings.push('ISA_EMAIL não definido — emails para ISA Certificação não terão destinatário');
  }

  for (const w of warnings) {
    logger.warn(`[ENV] ${w}`);
  }
  if (warnings.length === 0) {
    logger.info('[ENV] Todas as variáveis críticas estão configuradas');
  }
}

const server = app.listen(PORT, () => {
  logger.info(`API server running on port ${PORT}`);

  // Check critical env vars
  checkEnvVars();

  // Start cron jobs
  if (process.env.NODE_ENV !== 'test') {
    void initCache().catch((err) => {
      logger.error({ err }, 'Cache failed to initialize');
    });

    startScheduler();
    logger.info('Scheduler started');

    void initQueue()
      .then(async (boss) => {
        await registerWorkers(boss);
      })
      .catch((err) => {
        logger.error({ err }, 'Queue workers failed to start');
      });
  }
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  server.close(() => {
    logger.info('HTTP server closed');
    void Promise.all([
      stopQueue().catch((err) => logger.error({ err }, 'Failed to stop job queue')),
      stopCache().catch((err) => logger.error({ err }, 'Failed to stop cache')),
    ]).finally(() => process.exit(0));
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  shutdown('uncaughtException');
});
