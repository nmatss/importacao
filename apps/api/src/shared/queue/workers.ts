import type PgBoss from 'pg-boss';
import { logger } from '../utils/logger.js';

// ── Job type definitions ─────────────────────────────────────────────

export interface DriveSyncJob {
  processId: number;
  processCode: string;
  action:
    | 'upload'
    | 'sync_folder'
    | 'move_to_processados'
    | 'move_to_correction'
    | 'move_from_correction';
  filePath?: string;
  filename?: string;
  brand?: string;
  docType?: string;
  documentId?: number;
  sistemaFileId?: string;
}

export interface SheetsSyncJob {
  processId: number;
  processCode?: string;
  action: 'update_row' | 'full_sync' | 'sync_milestone';
  milestone?: string;
  date?: string;
}

export interface AIExtractionJob {
  documentId: number;
  processId: number;
  documentType: string;
  filePath: string;
}

// ── Worker wrapper with logging ──────────────────────────────────────

function wrapWorker<T extends object>(
  jobName: string,
  handler: (data: T) => Promise<void>,
): (jobs: PgBoss.Job<T>[]) => Promise<void> {
  return async (jobs: PgBoss.Job<T>[]) => {
    for (const job of jobs) {
      const startTime = Date.now();
      logger.info({ jobId: job.id, jobName }, `Job started: ${jobName}`);

      try {
        await handler(job.data);
        const durationMs = Date.now() - startTime;
        logger.info({ jobId: job.id, jobName, durationMs }, `Job completed: ${jobName}`);
      } catch (err) {
        const durationMs = Date.now() - startTime;
        logger.error({ err, jobId: job.id, jobName, durationMs }, `Job failed: ${jobName}`);
        throw err; // pg-boss will handle retry
      }
    }
  };
}

// ── Worker handlers ──────────────────────────────────────────────────

async function handleDriveSync(data: DriveSyncJob): Promise<void> {
  const { googleDriveService } = await import('../../modules/integrations/google-drive.service.js');
  const configured = await googleDriveService.isRootConfigured();
  if (!configured) {
    logger.warn('Google Drive not configured, skipping drive-sync job');
    return;
  }

  const brand = data.brand || 'puket';

  switch (data.action) {
    case 'upload': {
      if (!data.filePath || !data.filename)
        throw new Error('Missing filePath/filename for drive upload');
      const driveFileId = await googleDriveService.uploadToProcessFolder(
        data.processCode,
        brand,
        data.docType || 'other',
        data.filePath,
        data.filename,
      );
      if (data.documentId) {
        const { db } = await import('../database/connection.js');
        const { documents } = await import('../database/schema.js');
        const { eq } = await import('drizzle-orm');
        await db
          .update(documents)
          .set({ driveFileId, updatedAt: new Date() })
          .where(eq(documents.id, data.documentId));
      }
      logger.info({ documentId: data.documentId, driveFileId }, 'Drive upload completed via queue');
      break;
    }
    case 'sync_folder':
      await googleDriveService.ensureProcessFolder(data.processCode, brand);
      break;
    case 'move_to_processados': {
      if (!data.sistemaFileId) throw new Error('Missing sistemaFileId for move_to_processados');
      await googleDriveService.moveFromInboxToProcessados(
        data.sistemaFileId,
        data.processCode,
        data.docType || 'other',
      );
      logger.info({ processCode: data.processCode }, 'Moved from INBOX to PROCESSADOS via queue');
      break;
    }
    case 'move_to_correction':
      await googleDriveService.moveToCorrection(data.processCode, brand);
      logger.info({ processCode: data.processCode }, 'Moved to correction folder via queue');
      break;
    case 'move_from_correction':
      await googleDriveService.moveFromCorrection(data.processCode, brand);
      logger.info({ processCode: data.processCode }, 'Moved from correction folder via queue');
      break;
    default:
      logger.warn({ action: data.action }, 'Unknown drive-sync action');
  }
}

async function handleSheetsSync(data: SheetsSyncJob): Promise<void> {
  switch (data.action) {
    case 'sync_milestone': {
      if (!data.processCode || !data.milestone || !data.date) {
        throw new Error('Missing processCode/milestone/date for sync_milestone');
      }
      const { googleSheetsService } =
        await import('../../modules/integrations/google-sheets.service.js');
      await googleSheetsService.syncMilestone(
        data.processCode,
        data.milestone,
        new Date(data.date),
      );
      logger.info(
        { processCode: data.processCode, milestone: data.milestone },
        'Milestone synced to Sheets via queue',
      );
      break;
    }
    case 'full_sync': {
      logger.info(
        { processId: data.processId, action: data.action },
        'Full sheets sync job processed',
      );
      break;
    }
    default:
      logger.info({ processId: data.processId, action: data.action }, 'Sheets sync job processed');
  }
}

async function handleAIExtraction(data: AIExtractionJob): Promise<void> {
  const { documentService } = await import('../../modules/documents/service.js');
  await documentService.processWithAI(data.documentId, data.documentType);
}

/**
 * A fila `email-send` foi REMOVIDA em 2026-08-29.
 *
 * Ela existia, tinha worker registrado e nenhum enfileirador em todo o
 * repositorio — era um caminho morto que enviava e-mail SEM a allow-list de
 * destinatario (`isRecipientAllowed`) e SEM a sanitizacao de HTML
 * (`sanitizeEmailHtml`) que `communications/service.ts` aplica. O risco nao era
 * corrente, era latente: o proximo a precisar de envio assincrono usaria o
 * atalho "que ja existe" e contornaria os dois controles.
 *
 * Envio de e-mail passa exclusivamente por `communicationService.send()`, que
 * resolve destinatario, sanitiza, anexa apenas documentos do proprio processo e
 * grava auditoria. Envio assincrono, se voltar a ser necessario, deve enfileirar
 * o ID de uma comunicacao ja persistida e delegar aquele servico.
 */
// ── Register all workers ─────────────────────────────────────────────

export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work<DriveSyncJob>(
    'drive-sync',
    { batchSize: 1 },
    wrapWorker('drive-sync', handleDriveSync),
  );

  await boss.work<SheetsSyncJob>(
    'sheets-sync',
    { batchSize: 1 },
    wrapWorker('sheets-sync', handleSheetsSync),
  );

  await boss.work<AIExtractionJob>(
    'ai-extraction',
    { batchSize: 1 },
    wrapWorker('ai-extraction', handleAIExtraction),
  );

  logger.info('Queue workers registered: email-send, drive-sync, sheets-sync, ai-extraction');
}
