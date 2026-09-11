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

  // Nao envia nada ao Chat. O envio que morava aqui era um SEGUNDO caminho de
  // entrega, fora de `delivery.service.ts`: sem persistencia, sem deduplicacao,
  // sem reentrega e sem o teto de tentativas. Estava morto (nenhum ponto do
  // codigo emite 'validation.completed', e em sete dias de log nao ha uma linha
  // 'Validação Concluída'), mas bastava alguem passar a emitir o evento para a
  // mensagem duplicada voltar. Quem avisa falha de validacao e o alerta
  // persistido criado por `validation/service.ts`.
  appEvents.on('validation.completed', (payload) => {
    logger.info(
      { processId: payload.processId, passed: payload.passed, failed: payload.failed },
      'Event: validation completed',
    );
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
