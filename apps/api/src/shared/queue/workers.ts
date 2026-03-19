import type PgBoss from 'pg-boss';
import { logger } from '../utils/logger.js';

// ── Job type definitions ─────────────────────────────────────────────

export interface EmailSendJob {
  to: string;
  subject: string;
  body: string;
  processId?: number;
}

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
      logger.info({ jobId: job.id, jobName, data: job.data }, `Job started: ${jobName}`);

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

async function handleEmailSend(data: EmailSendJob): Promise<void> {
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: data.to,
    subject: data.subject,
    html: data.body,
  });
}

async function handleDriveSync(data: DriveSyncJob): Promise<void> {
  const { googleDriveService } = await import('../../modules/integrations/google-drive.service.js');
  const configured = await googleDriveService.isConfigured();
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
  await documentService.reprocess(data.documentId);
}

// ── Register all workers ─────────────────────────────────────────────

export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work<EmailSendJob>(
    'email-send',
    { batchSize: 1 },
    wrapWorker('email-send', handleEmailSend),
  );

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
