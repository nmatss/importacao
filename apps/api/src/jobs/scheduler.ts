import cron from 'node-cron';
import { checkDeadlines } from './deadline-check.js';
import { checkStalledProcesses } from './stalled-process.js';
import { checkEmails, doubleCheckEmails } from './email-check.js';
import { runLogisticSync } from './logistic-sync.js';
import { logger } from '../shared/utils/logger.js';
import { alertService } from '../modules/alerts/service.js';

async function handleCronError(jobName: string, error: unknown): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error({ error, jobName }, `Cron job failed: ${jobName}`);

  try {
    await alertService.create({
      severity: 'critical',
      title: `Falha no job: ${jobName}`,
      message: `O job agendado "${jobName}" falhou com o erro: ${errorMessage}`,
    });
  } catch (alertError) {
    logger.error({ alertError, jobName }, 'Failed to create alert for cron job failure');
  }
}

export function startScheduler() {
  const tz = { timezone: 'America/Sao_Paulo' };

  // Daily at 8:00 AM - Check deadlines (LI + currency)
  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        await checkDeadlines();
      } catch (error) {
        await handleCronError('deadline-check', error);
      }
    },
    tz,
  );

  // Daily at 9:00 AM - Check stalled processes
  cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        await checkStalledProcesses();
      } catch (error) {
        await handleCronError('stalled-process-check', error);
      }
    },
    tz,
  );

  // Every 5 minutes - Check for new emails
  cron.schedule(
    '*/5 * * * *',
    async () => {
      try {
        await checkEmails();
      } catch (error) {
        await handleCronError('email-check', error);
      }
    },
    tz,
  );

  // Daily at 22:00 - Double check: re-read all emails from today (includeRead=true)
  // Catches anything that might have been missed during the day
  cron.schedule(
    '0 22 * * 1-5',
    async () => {
      try {
        await doubleCheckEmails();
      } catch (error) {
        await handleCronError('email-double-check', error);
      }
    },
    tz,
  );

  // Every 30 minutes - Sync logistic status from process + follow-up state
  cron.schedule(
    '*/30 * * * *',
    async () => {
      try {
        await runLogisticSync();
      } catch (error) {
        await handleCronError('logistic-sync', error);
      }
    },
    tz,
  );

  logger.info(
    'Cron scheduler initialized: deadline check (8:00), stalled check (9:00), email check (*/5 min), double-check (22:00 weekdays), logistic-sync (*/30 min) - timezone: America/Sao_Paulo',
  );
}
