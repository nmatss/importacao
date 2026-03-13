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
  action: 'upload' | 'sync_folder';
  filePath?: string;
  filename?: string;
}

export interface SheetsSyncJob {
  processId: number;
  action: 'update_row' | 'full_sync';
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
  // Brand defaults to 'puket' for queue jobs; callers should include it in data if needed
  const brand = (data as DriveSyncJob & { brand?: string }).brand || 'puket';
  if (data.action === 'upload' && data.filePath && data.filename) {
    await googleDriveService.uploadToProcessFolder(
      data.processCode, brand, 'other', data.filePath, data.filename,
    );
  } else if (data.action === 'sync_folder') {
    await googleDriveService.ensureProcessFolder(data.processCode, brand);
  }
}

async function handleSheetsSync(_data: SheetsSyncJob): Promise<void> {
  // Sheets sync is handled by the follow-up module
  // Dynamic import to avoid circular dependencies
  const mod = await import('../../modules/follow-up/service.js');
  const service = mod.followUpService;

  // Use getAll as a sync check - specific sync methods will be added by follow-up module
  logger.info({ processId: _data.processId, action: _data.action }, 'Sheets sync job processed');
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
