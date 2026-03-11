import cron from 'node-cron';
import { checkDeadlines } from './deadline-check.js';
import { checkStalledProcesses } from './stalled-process.js';
import { checkEmails, doubleCheckEmails } from './email-check.js';
import { logger } from '../shared/utils/logger.js';

export function startScheduler() {
  const tz = { timezone: 'America/Sao_Paulo' };

  // Daily at 8:00 AM - Check deadlines (LI + currency)
  cron.schedule('0 8 * * *', async () => {
    try {
      await checkDeadlines();
    } catch (error) {
      logger.error({ error }, 'Deadline check job failed');
    }
  }, tz);

  // Daily at 9:00 AM - Check stalled processes
  cron.schedule('0 9 * * *', async () => {
    try {
      await checkStalledProcesses();
    } catch (error) {
      logger.error({ error }, 'Stalled process check job failed');
    }
  }, tz);

  // Every 5 minutes - Check for new emails
  cron.schedule('*/5 * * * *', async () => {
    try {
      await checkEmails();
    } catch (error) {
      logger.error({ error }, 'Email check job failed');
    }
  }, tz);

  // Daily at 22:00 - Double check: re-read all emails from today (includeRead=true)
  // Catches anything that might have been missed during the day
  cron.schedule('0 22 * * 1-5', async () => {
    try {
      await doubleCheckEmails();
    } catch (error) {
      logger.error({ error }, 'Email double-check job failed');
    }
  }, tz);

  logger.info('Cron scheduler initialized: deadline check (8:00), stalled check (9:00), email check (*/5 min), double-check (22:00 weekdays) - timezone: America/Sao_Paulo');
}
