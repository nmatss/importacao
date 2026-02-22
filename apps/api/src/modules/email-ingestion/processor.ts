import fs from 'fs/promises';
import path from 'path';
import { eq, desc, count, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { emailIngestionLogs, importProcesses, followUpTracking } from '../../shared/database/schema.js';
import { documentService } from '../documents/service.js';
import { gmailService } from './gmail.service.js';
import { imapService } from './imap.service.js';
import { logger } from '../../shared/utils/logger.js';
import { auditService } from '../audit/service.js';

const UPLOAD_DIR = path.resolve('uploads');

function extractProcessCode(subject: string): string | null {
  const patterns = [
    /\b(IMP[-_]?\d{4}[-_]?\d{3,})\b/i,
    /\b(PU?K(?:ET)?[-_]?\d{3,})\b/i,
    /\b(IMAG(?:INARIUM)?[-_]?\d{3,})\b/i,
    /\b([A-Z]{2,10}[-_]\d{4}[-_]\d{2,})\b/i,
    /\b(\d{4}[-/]\d{5,})\b/,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function classifyDocument(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('invoice') || lower.includes('fatura') || lower.includes('commercial') || lower.includes('inv')) return 'invoice';
  if (lower.includes('packing') || lower.includes('pl') || lower.includes('pack')) return 'packing_list';
  if (lower.includes('bl') || lower.includes('bill') || lower.includes('lading') || lower.includes('conhecimento') || lower.includes('ohbl')) return 'ohbl';
  if (lower.includes('espelho')) return 'espelho';
  if (lower.includes('li') || lower.includes('licen')) return 'li';
  return 'other';
}

function detectBrand(subject: string, from: string): 'puket' | 'imaginarium' {
  const text = `${subject} ${from}`.toLowerCase();
  if (text.includes('imaginarium') || text.includes('imag')) return 'imaginarium';
  return 'puket';
}

// Allowed sender filter - only process emails from these domains/addresses
// Configured via EMAIL_ALLOWED_SENDERS env var (comma-separated)
// e.g. EMAIL_ALLOWED_SENDERS=kiom.com.br,@kiom.com,noreply@kiom.com.br
function isAllowedSender(from: string): boolean {
  const allowedRaw = process.env.EMAIL_ALLOWED_SENDERS;
  if (!allowedRaw) return true; // No filter = accept all

  const allowed = allowedRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const fromLower = from.toLowerCase();

  return allowed.some(pattern => fromLower.includes(pattern));
}

export const emailProcessor = {
  async processNewEmails(includeRead = false) {
    // Prefer Gmail API (service account), fall back to IMAP
    let emails;
    if (gmailService.isConfigured()) {
      logger.info({ includeRead }, 'Using Gmail API for email ingestion');
      emails = await gmailService.fetchUnseenEmails(includeRead);
    } else {
      logger.info('Gmail API not configured, falling back to IMAP');
      emails = await imapService.fetchUnseenEmails();
    }

    for (const email of emails) {
      const [existing] = await db.select()
        .from(emailIngestionLogs)
        .where(eq(emailIngestionLogs.messageId, email.messageId))
        .limit(1);

      if (existing) {
        logger.debug({ messageId: email.messageId }, 'Email already processed, skipping');
        continue;
      }

      // Filter by allowed senders (e.g. Kiom)
      if (!isAllowedSender(email.from)) {
        logger.debug({ from: email.from }, 'Email from non-allowed sender, ignoring');
        await db.insert(emailIngestionLogs).values({
          messageId: email.messageId,
          fromAddress: email.from,
          subject: email.subject,
          receivedAt: email.date,
          attachmentsCount: email.attachments.length,
          status: 'ignored',
          errorMessage: 'Remetente não autorizado',
        });
        continue;
      }

      const [logEntry] = await db.insert(emailIngestionLogs).values({
        messageId: email.messageId,
        fromAddress: email.from,
        subject: email.subject,
        receivedAt: email.date,
        attachmentsCount: email.attachments.length,
        status: 'processing',
      }).returning();

      try {
        if (email.attachments.length === 0) {
          await db.update(emailIngestionLogs)
            .set({ status: 'ignored', errorMessage: 'Sem anexos relevantes' })
            .where(eq(emailIngestionLogs.id, logEntry.id));
          continue;
        }

        const processCode = extractProcessCode(email.subject);
        let processId: number | null = null;

        if (processCode) {
          const [existingProcess] = await db.select()
            .from(importProcesses)
            .where(eq(importProcesses.processCode, processCode))
            .limit(1);

          if (existingProcess) {
            processId = existingProcess.id;
          } else {
            const brand = detectBrand(email.subject, email.from);
            const [newProcess] = await db.insert(importProcesses).values({
              processCode,
              brand,
              status: 'draft',
              notes: `Processo criado automaticamente a partir do email: ${email.subject}`,
            }).returning();
            processId = newProcess.id;

            await db.insert(followUpTracking).values({ processId: newProcess.id });
            logger.info({ processCode, processId: newProcess.id }, 'New process created from email');
          }
        }

        const processedAttachments: Array<{ filename: string; type: string; documentId?: number }> = [];

        for (const att of email.attachments) {
          await fs.mkdir(UPLOAD_DIR, { recursive: true });
          const safeName = `${Date.now()}-${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const filePath = path.join(UPLOAD_DIR, safeName);
          await fs.writeFile(filePath, att.content);

          const docType = classifyDocument(att.filename);

          if (processId) {
            const fakeFile = {
              originalname: att.filename,
              path: filePath,
              mimetype: att.contentType,
              size: att.size,
            } as Express.Multer.File;

            const doc = await documentService.upload(processId, docType, fakeFile);

            processedAttachments.push({ filename: att.filename, type: docType, documentId: doc.id });
          } else {
            processedAttachments.push({ filename: att.filename, type: docType });
          }
        }

        await db.update(emailIngestionLogs)
          .set({
            status: 'completed',
            processId,
            processCode,
            processedAttachments,
          })
          .where(eq(emailIngestionLogs.id, logEntry.id));

        auditService.log(null, 'email_processed', 'email', logEntry.id, { from: email.from, subject: email.subject, processCode, attachments: processedAttachments.length }, null);
        logger.info({ messageId: email.messageId, processCode, attachments: processedAttachments.length }, 'Email processed successfully');
      } catch (error: any) {
        await db.update(emailIngestionLogs)
          .set({ status: 'failed', errorMessage: error.message })
          .where(eq(emailIngestionLogs.id, logEntry.id));
        logger.error({ err: error, messageId: email.messageId }, 'Failed to process email');
      }
    }
  },

  async getStatus() {
    const enabled = process.env.EMAIL_INGESTION_ENABLED === 'true';
    const gmailConfigured = gmailService.isConfigured();
    const imapConfigured = !!(process.env.IMAP_USER && process.env.IMAP_PASS);

    const [lastLog] = await db.select()
      .from(emailIngestionLogs)
      .orderBy(desc(emailIngestionLogs.createdAt))
      .limit(1);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    const stats = await db.select({
      status: emailIngestionLogs.status,
      count: count(),
    })
      .from(emailIngestionLogs)
      .where(sql`${emailIngestionLogs.createdAt} >= ${todayStr}`)
      .groupBy(emailIngestionLogs.status);

    return {
      enabled,
      method: gmailConfigured ? 'gmail_api' : imapConfigured ? 'imap' : 'none',
      gmailConfigured,
      imapConfigured,
      sharedMailbox: process.env.GMAIL_SHARED_MAILBOX || null,
      allowedSenders: process.env.EMAIL_ALLOWED_SENDERS || '(todos)',
      lastRun: lastLog?.createdAt || null,
      todayStats: stats,
    };
  },

  async getLogs(page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [data, [{ total }]] = await Promise.all([
      db.select()
        .from(emailIngestionLogs)
        .orderBy(desc(emailIngestionLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(emailIngestionLogs),
    ]);

    return { data, total, page, limit };
  },

  async reprocess(logId: number) {
    const [log] = await db.select()
      .from(emailIngestionLogs)
      .where(eq(emailIngestionLogs.id, logId))
      .limit(1);

    if (!log) throw new Error('Log não encontrado');
    if (log.status !== 'failed') throw new Error('Apenas emails com falha podem ser reprocessados');

    await db.update(emailIngestionLogs)
      .set({ status: 'processing', errorMessage: null })
      .where(eq(emailIngestionLogs.id, logId));

    try {
      // Try to re-fetch from Gmail if configured
      if (gmailService.isConfigured() && log.messageId) {
        const gmail = await import('@googleapis/gmail');
        // Re-process using processNewEmails flow but for single message
        // Reset the log so processNewEmails won't skip it
        await db.update(emailIngestionLogs)
          .set({ status: 'pending', errorMessage: null })
          .where(eq(emailIngestionLogs.id, logId));

        // Delete old log so processNewEmails re-processes the messageId
        await db.delete(emailIngestionLogs)
          .where(eq(emailIngestionLogs.id, logId));

        // Trigger a new email check which will pick up the message again
        await this.processNewEmails();

        return { message: 'Email reprocessado via Gmail API' };
      }

      // Fallback: re-process from locally saved attachments if a process was created
      if (log.processId) {
        const processedAttachments = log.processedAttachments as Array<{ filename: string; type: string; documentId?: number }> | null;
        if (processedAttachments && processedAttachments.length > 0) {
          for (const att of processedAttachments) {
            if (att.documentId) {
              await documentService.reprocess(att.documentId);
            }
          }

          await db.update(emailIngestionLogs)
            .set({ status: 'completed', errorMessage: null })
            .where(eq(emailIngestionLogs.id, logId));

          return { message: 'Documentos reprocessados a partir dos arquivos locais' };
        }
      }

      await db.update(emailIngestionLogs)
        .set({ status: 'failed', errorMessage: 'Nenhum método de reprocessamento disponível' })
        .where(eq(emailIngestionLogs.id, logId));

      return { message: 'Nenhum método de reprocessamento disponível' };
    } catch (error: any) {
      await db.update(emailIngestionLogs)
        .set({ status: 'failed', errorMessage: error.message })
        .where(eq(emailIngestionLogs.id, logId));
      throw error;
    }
  },
};
