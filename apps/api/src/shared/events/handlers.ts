import { appEvents } from './emitter.js';
import { logger } from '../utils/logger.js';

/**
 * Register all event handlers.
 * Call once at startup after all modules are loaded.
 */
export function registerEventHandlers(): void {
  appEvents.on('process.created', (payload) => {
    logger.info(
      { processId: payload.processId, processCode: payload.processCode },
      'Event: process created',
    );
  });

  appEvents.on('process.status_changed', async (payload) => {
    logger.info(
      { processId: payload.processId, from: payload.from, to: payload.to },
      'Event: process status changed',
    );

    // Sync status milestone to Google Sheets
    try {
      const milestoneMap: Record<string, string> = {
        documents_received: 'documentsReceivedAt',
        validated: 'preInspectionAt',
        espelho_generated: 'espelhoGeneratedAt',
        sent_to_fenicia: 'sentToFeniciaAt',
      };
      const milestone = milestoneMap[payload.to];
      if (milestone) {
        const { db } = await import('../database/connection.js');
        const { importProcesses } = await import('../database/schema.js');
        const { eq } = await import('drizzle-orm');

        const [proc] = await db
          .select({ processCode: importProcesses.processCode })
          .from(importProcesses)
          .where(eq(importProcesses.id, payload.processId))
          .limit(1);

        if (proc?.processCode) {
          const { googleSheetsService } =
            await import('../../modules/integrations/google-sheets.service.js');
          await googleSheetsService.syncMilestone(proc.processCode, milestone, new Date());
          logger.info(
            { processId: payload.processId, milestone },
            'Status milestone synced to Sheets',
          );
        }
      }
    } catch (err) {
      logger.error({ err, processId: payload.processId }, 'Failed to sync status change to Sheets');
    }
  });

  appEvents.on('document.uploaded', (payload) => {
    logger.info(
      { documentId: payload.documentId, processId: payload.processId, type: payload.type },
      'Event: document uploaded',
    );
  });

  appEvents.on('validation.completed', async (payload) => {
    logger.info(
      { processId: payload.processId, passed: payload.passed, failed: payload.failed },
      'Event: validation completed',
    );

    // Notify Google Chat on validation failures
    if (payload.failed > 0) {
      try {
        const { db } = await import('../database/connection.js');
        const { importProcesses, systemSettings } = await import('../database/schema.js');
        const { eq } = await import('drizzle-orm');

        const [proc] = await db
          .select({ processCode: importProcesses.processCode })
          .from(importProcesses)
          .where(eq(importProcesses.id, payload.processId))
          .limit(1);

        const [setting] = await db
          .select()
          .from(systemSettings)
          .where(eq(systemSettings.key, 'google_chat_webhook_url'))
          .limit(1);

        const rawValue = setting?.value;
        const webhookUrl =
          (typeof rawValue === 'string'
            ? rawValue
            : typeof rawValue === 'object' && rawValue !== null && 'url' in rawValue
              ? (rawValue as { url: string }).url
              : null) || process.env.GOOGLE_CHAT_WEBHOOK_URL;
        if (webhookUrl && proc) {
          const { sendToGoogleChat } = await import('../../modules/alerts/google-chat.service.js');
          const severity = payload.failed > 3 ? 'critical' : 'warning';
          await sendToGoogleChat(webhookUrl, {
            severity,
            title: `Validação Concluída - ${proc.processCode}`,
            message: `Processo ${proc.processCode}: ${payload.passed} checks OK, ${payload.failed} falha(s).`,
            processCode: proc.processCode,
          });
        }
      } catch (err) {
        logger.error(
          { err, processId: payload.processId },
          'Failed to notify validation results via event handler',
        );
      }
    }
  });

  appEvents.on('espelho.generated', (payload) => {
    logger.info(
      { processId: payload.processId, espelhoId: payload.espelhoId },
      'Event: espelho generated',
    );
  });

  appEvents.on('email.ingested', (payload) => {
    logger.info(
      { emailId: payload.emailId, processId: payload.processId },
      'Event: email ingested',
    );
  });

  logger.info('Event handlers registered');
}
