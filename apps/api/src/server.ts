import { app } from './app.js';
import { logger } from './shared/utils/logger.js';
import { startScheduler } from './jobs/scheduler.js';

const PORT = process.env.API_PORT || 3001;

const server = app.listen(PORT, () => {
  logger.info(`API server running on port ${PORT}`);

  // Start cron jobs
  if (process.env.NODE_ENV !== 'test') {
    startScheduler();
    logger.info('Scheduler started');
  }
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
