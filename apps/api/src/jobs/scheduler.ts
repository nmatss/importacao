import cron from 'node-cron';
import { checkDeadlines } from './deadline-check.js';
import { checkStalledProcesses } from './stalled-process.js';
import { checkEmails, doubleCheckEmails } from './email-check.js';
import { runLogisticSync } from './logistic-sync.js';
import { runFinancialCheck } from './financial-check.js';
import { logger } from '../shared/utils/logger.js';
import { alertService } from '../modules/alerts/service.js';
import { preConsService } from '../modules/pre-cons/service.js';

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

  // Pre-Cons drive sync só roda se a pasta do Drive estiver configurada (e
  // compartilhada com a SA). Avisa no boot quando ausente para não passar
  // despercebido que a sync semanal está silenciosamente desligada.
  if (!process.env.GOOGLE_DRIVE_PRE_CONS_FOLDER_ID) {
    logger.warn(
      'GOOGLE_DRIVE_PRE_CONS_FOLDER_ID não configurado: a sync de Pre-Cons do Drive (*/6h) será pulada',
    );
  }

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

  // Daily at 8:30 AM - Financial check (invoice baixa, seguro, demurrage)
  cron.schedule(
    '30 8 * * *',
    async () => {
      try {
        await runFinancialCheck();
      } catch (error) {
        await handleCronError('financial-check', error);
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

  // Every 6 hours - Sync Pre-Cons spreadsheet from Google Drive (no-op when unconfigured)
  cron.schedule(
    '0 */6 * * *',
    async () => {
      try {
        const result = await preConsService.syncFromDrive();
        if (result.skipped) {
          logger.info({ reason: result.reason }, 'Pre-Cons drive sync skipped');
        }
      } catch (error) {
        await handleCronError('pre-cons-drive-sync', error);
      }
    },
    tz,
  );

  logger.info(
    'Cron scheduler initialized: deadline check (8:00), financial check (8:30), stalled check (9:00), email check (*/5 min), double-check (22:00 weekdays), logistic-sync (*/30 min), pre-cons-drive-sync (*/6h) - timezone: America/Sao_Paulo',
  );
}
