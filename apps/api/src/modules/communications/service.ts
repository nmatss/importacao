import { eq, desc, count, and, sql, gte } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import path from 'node:path';
import { db } from '../../shared/database/connection.js';
import {
  communications,
  documents,
  importProcesses,
  espelhos,
  validationResults,
  emailSignatures,
} from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import type { CreateCommunicationInput } from './schema.js';
import { feniciaSubmissionTemplate } from './templates/fenicia-submission.js';
import { aiService } from '../ai/service.js';
import { kiomCorrectionTemplate } from './templates/kiom-correction.js';
import { auditService } from '../audit/service.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';
import { AppError } from '../../shared/errors/index.js';

const KIOM_EMAIL = process.env.KIOM_EMAIL || '';

interface StoredAttachment {
  filename?: unknown;
  documentId?: unknown;
  espelhoId?: unknown;
  path?: unknown;
}

interface MailAttachment {
  filename: string;
  path: string;
}

function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove style tags and their content (can contain expressions)
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Remove all event handler attributes (onclick, onerror, onload, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript:, vbscript:, data: URLs from href/src/action attributes
  clean = clean.replace(
    /(href|src|action)\s*=\s*(?:"(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi,
    '',
  );
  // Remove dangerous tags: svg, math, iframe, object, embed, form, base
  clean = clean.replace(/<\/?(svg|math|iframe|object|embed|form|base|link|meta)\b[^>]*>/gi, '');
  return clean;
}

function getSmtpTransport() {
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const hasAuth = user && pass && user !== 'noreply@grupounico.com'; // Skip auth for internal relay

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    ...(hasAuth ? { auth: { user, pass } } : {}),
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
      minVersion: 'TLSv1.2',
    },
  });
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function allowedRecipientPatterns(): string[] {
  return [
    process.env.KIOM_EMAIL,
    process.env.FENICIA_EMAIL,
    process.env.ISA_EMAIL,
    process.env.COMMUNICATION_ALLOWED_RECIPIENTS,
  ]
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isRecipientAllowed(recipientEmail: string): boolean {
  const recipient = normalizeEmail(recipientEmail);
  const patterns = allowedRecipientPatterns();
  if (patterns.length === 0) return false;

  return patterns.some((pattern) => {
    if (pattern.startsWith('@')) {
      const domain = pattern.slice(1);
      return recipient.endsWith(`@${domain}`) || recipient.endsWith(`.${domain}`);
    }
    if (pattern.includes('@')) return recipient === pattern;
    return recipient.endsWith(`@${pattern}`) || recipient.endsWith(`.${pattern}`);
  });
}

function sanitizeAttachmentFilename(filename: unknown, fallback: string): string {
  const raw = typeof filename === 'string' && filename.trim() ? filename.trim() : fallback;
  const clean = path
    .basename(raw)
    .replace(/[\r\n]/g, '')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
    .join('')
    .slice(0, 255);

  if (!clean) throw new Error('Nome de anexo invalido');
  return clean;
}

async function resolveMailAttachments(communication: {
  processId: number | null;
  attachments: unknown;
}): Promise<MailAttachment[] | undefined> {
  if (!communication.attachments) return undefined;
  if (!Array.isArray(communication.attachments)) {
    throw new Error('Formato de anexos invalido');
  }

  const requested = communication.attachments as StoredAttachment[];
  if (requested.length === 0) return undefined;
  if (!communication.processId) {
    throw new Error('Anexos exigem uma comunicacao vinculada a um processo');
  }

  const [processDocuments, processEspelhos] = await Promise.all([
    db.select().from(documents).where(eq(documents.processId, communication.processId)),
    db.select().from(espelhos).where(eq(espelhos.processId, communication.processId)),
  ]);

  const documentsById = new Map(processDocuments.map((doc) => [doc.id, doc]));
  const documentsByPath = new Map(processDocuments.map((doc) => [doc.storagePath, doc]));
  const espelhoFiles = processEspelhos
    .map((espelho) => {
      const data = espelho.generatedData as Record<string, unknown> | null;
      const filePath = typeof data?.filePath === 'string' ? data.filePath : null;
      const filename = typeof data?.filename === 'string' ? data.filename : `espelho-${espelho.id}`;
      return filePath ? { id: espelho.id, filePath, filename } : null;
    })
    .filter((item): item is { id: number; filePath: string; filename: string } => Boolean(item));
  const espelhosById = new Map(espelhoFiles.map((espelho) => [espelho.id, espelho]));
  const espelhosByPath = new Map(espelhoFiles.map((espelho) => [espelho.filePath, espelho]));

  return requested.map((attachment) => {
    if (attachment.documentId != null) {
      const documentId = Number(attachment.documentId);
      const document = documentsById.get(documentId);
      if (!document) throw new Error(`Anexo de documento nao autorizado: ${documentId}`);
      return {
        filename: sanitizeAttachmentFilename(attachment.filename, document.originalFilename),
        path: document.storagePath,
      };
    }

    if (attachment.espelhoId != null) {
      const espelhoId = Number(attachment.espelhoId);
      const espelhoFile = espelhosById.get(espelhoId);
      if (!espelhoFile) throw new Error(`Anexo de espelho nao autorizado: ${espelhoId}`);
      return {
        filename: sanitizeAttachmentFilename(attachment.filename, espelhoFile.filename),
        path: espelhoFile.filePath,
      };
    }

    if (typeof attachment.path === 'string' && attachment.path.trim()) {
      const document = documentsByPath.get(attachment.path);
      if (document) {
        return {
          filename: sanitizeAttachmentFilename(attachment.filename, document.originalFilename),
          path: document.storagePath,
        };
      }

      const espelhoFile = espelhosByPath.get(attachment.path);
      if (espelhoFile) {
        return {
          filename: sanitizeAttachmentFilename(attachment.filename, espelhoFile.filename),
          path: espelhoFile.filePath,
        };
      }
    }

    throw new Error('Anexo invalido ou fora do processo');
  });
}

export const communicationService = {
  async list(processId?: number, page = 1, limit = 20, startDate?: string, endDate?: string) {
    const conditions = [];
    if (processId) conditions.push(eq(communications.processId, processId));
    if (startDate) {
      conditions.push(gte(communications.createdAt, new Date(startDate)));
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setDate(end.getDate() + 1);
      conditions.push(sql`${communications.createdAt} < ${end.toISOString()}`);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * limit;

    const [data, [{ total }]] = await Promise.all([
      db
        .select()
        .from(communications)
        .where(where)
        .orderBy(desc(communications.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(communications).where(where),
    ]);

    return { data, total, page, limit };
  },

  async create(input: CreateCommunicationInput) {
    const [communication] = await db
      .insert(communications)
      .values({
        processId: input.processId,
        recipient: input.recipient,
        recipientEmail: input.recipientEmail,
        subject: input.subject,
        body: sanitizeHtml(input.body),
        attachments: input.attachments,
        status: 'draft',
      })
      .returning();

    return communication;
  },

  async send(id: number, signatureId?: number, userId?: number | null) {
    const [communication] = await db
      .select()
      .from(communications)
      .where(eq(communications.id, id))
      .limit(1);

    if (!communication) throw new Error('Comunicação não encontrada');
    if (communication.status !== 'draft') {
      throw new Error('Somente rascunhos podem ser enviados');
    }

    if (!communication.recipientEmail) {
      throw new Error(
        'E-mail do destinatário não configurado. Verifique as variáveis KIOM_EMAIL / FENICIA_EMAIL / ISA_EMAIL.',
      );
    }

    if (!isRecipientAllowed(communication.recipientEmail)) {
      throw new AppError(
        'Destinatário não autorizado para envio. Configure COMMUNICATION_ALLOWED_RECIPIENTS ou use um destinatário operacional previsto.',
        403,
        'RECIPIENT_NOT_ALLOWED',
      );
    }

    if (!process.env.SMTP_HOST) {
      throw new Error('SMTP não configurado. Defina SMTP_HOST nas variáveis de ambiente.');
    }

    const transport = getSmtpTransport();

    try {
      const mailAttachments = await resolveMailAttachments(communication);

      // Append signature if provided
      let htmlBody = communication.body;
      if (signatureId) {
        const [signature] = await db
          .select()
          .from(emailSignatures)
          .where(
            userId
              ? and(eq(emailSignatures.id, signatureId), eq(emailSignatures.userId, userId))
              : eq(emailSignatures.id, signatureId),
          )
          .limit(1);
        if (!signature) {
          throw new AppError(
            'Assinatura de e-mail não encontrada para este usuário',
            404,
            'SIGNATURE_NOT_FOUND',
          );
        }
        htmlBody = `${htmlBody}<br/><br/>${signature.signatureHtml}`;
      }

      // Sanitize headers to prevent CRLF injection
      const sanitizeHeader = (v: string) => v.replace(/[\r\n]/g, '').trim();

      await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: sanitizeHeader(communication.recipientEmail),
        subject: sanitizeHeader(communication.subject),
        html: sanitizeHtml(htmlBody),
        attachments: mailAttachments,
      });

      const [updated] = await db
        .update(communications)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(communications.id, id))
        .returning();

      logger.info({ id, to: communication.recipientEmail }, 'E-mail enviado com sucesso');
      await auditService.log(
        userId ?? null,
        'email.sent',
        'communication',
        updated.id,
        { to: communication.recipientEmail, subject: communication.subject },
        null,
      );

      // Record timeline event
      if (communication.processId) {
        recordProcessEvent(
          communication.processId,
          {
            eventType: 'email_sent',
            title: `Email enviado para ${communication.recipientEmail}`,
            metadata: { subject: communication.subject, communicationId: updated.id },
          },
          userId ?? null,
        );
      }

      return updated;
    } catch (error: any) {
      await db
        .update(communications)
        .set({ status: 'failed', errorMessage: error.message })
        .where(eq(communications.id, id));

      logger.error({ id, error: error.message }, 'Falha ao enviar e-mail');
      if (error?.statusCode) throw error;
      throw new Error(`Falha ao enviar e-mail: ${error.message}`);
    }
  },

  async sendToFenicia(processId: number) {
    // Get process data
    const [proc] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!proc) throw new Error('Processo não encontrado');

    // Get documents for attachments
    const docs = await db.select().from(documents).where(eq(documents.processId, processId));

    // Get latest espelho
    const [espelho] = await db
      .select()
      .from(espelhos)
      .where(eq(espelhos.processId, processId))
      .orderBy(desc(espelhos.createdAt))
      .limit(1);

    // Build attachments list
    const attachments: Array<{ filename: string; documentId?: number; espelhoId?: number }> = [];
    for (const doc of docs) {
      if (['invoice', 'packing_list', 'ohbl'].includes(doc.type)) {
        attachments.push({
          filename: doc.originalFilename,
          documentId: doc.id,
        });
      }
    }

    if (espelho) {
      const espelhoData = espelho.generatedData as Record<string, string> | null;
      if (espelhoData?.filePath && espelhoData?.filename) {
        attachments.push({
          filename: espelhoData.filename,
          espelhoId: espelho.id,
        });
      }
    }

    // Generate email from template
    const { subject, body } = feniciaSubmissionTemplate({
      processCode: proc.processCode,
      brand: proc.brand,
      exporterName: proc.exporterName ?? undefined,
      importerName: proc.importerName ?? undefined,
      totalFobValue: proc.totalFobValue ?? undefined,
      incoterm: proc.incoterm ?? undefined,
      totalBoxes: proc.totalBoxes ?? undefined,
      portOfLoading: proc.portOfLoading ?? undefined,
      portOfDischarge: proc.portOfDischarge ?? undefined,
      etd: proc.etd ?? undefined,
      eta: proc.eta ?? undefined,
    });

    const feniciaEmail = process.env.FENICIA_EMAIL || '';

    return this.create({
      processId,
      recipient: 'Fenícia',
      recipientEmail: feniciaEmail,
      subject,
      body,
      attachments,
    });
  },

  async generateCorrectionDraft(processId: number, useAi = false) {
    // Get process data
    const [proc] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!proc) throw new Error('Processo nao encontrado');

    // Get all failed validation results
    const results = await db
      .select()
      .from(validationResults)
      .where(eq(validationResults.processId, processId));

    const failedResults = results.filter((r) => r.status === 'failed' && !r.resolvedManually);

    if (failedResults.length === 0) {
      throw new Error('Nenhuma divergencia encontrada para gerar e-mail de correcao');
    }

    const [existingDraft] = await db
      .select()
      .from(communications)
      .where(
        and(
          eq(communications.processId, processId),
          eq(communications.recipient, 'KIOM'),
          eq(communications.status, 'draft'),
        ),
      )
      .orderBy(desc(communications.createdAt))
      .limit(1);

    if (existingDraft) {
      logger.info(
        { processId, failedCount: failedResults.length, communicationId: existingDraft.id },
        'Existing KIOM correction draft reused',
      );
      return existingDraft;
    }

    // Categorize divergences
    const categoryMap: Record<string, string> = {
      'fob-value-match': 'value',
      'total-value-match': 'value',
      'freight-value-match': 'value',
      'invoice-value-vs-fup': 'value',
      'freight-vs-fup': 'value',
      'net-weight-match': 'weight',
      'gross-weight-match': 'weight',
      'boxes-match': 'weight',
      'cbm-vs-fup': 'weight',
      'invoice-number-match': 'document',
      'date-match': 'document',
      'exporter-match': 'document',
      'importer-match': 'document',
      'incoterm-match': 'document',
      'ports-match': 'logistics',
      'container-type-vs-fup': 'logistics',
      'bl-shipper-match': 'logistics',
      'bl-consignee-match': 'logistics',
      'bl-notify-match': 'logistics',
    };

    const divergences = failedResults.map((r) => ({
      checkName: r.checkName,
      category: categoryMap[r.checkName] || 'other',
      expectedValue: r.expectedValue ?? undefined,
      actualValue: r.actualValue ?? undefined,
      message: r.message ?? '',
    }));

    // Get invoice number from documents
    const docs = await db.select().from(documents).where(eq(documents.processId, processId));

    const invoiceDoc = docs.find((d) => d.type === 'invoice');
    const rawInvoiceData = invoiceDoc?.aiParsedData as Record<string, any> | null;
    // Extract plain value from { value, confidence } structure
    const invoiceNumber =
      rawInvoiceData?.invoiceNumber?.value ?? rawInvoiceData?.invoiceNumber ?? undefined;

    let subject: string;
    let body: string;

    if (useAi) {
      // Use AI to generate a polished correction email
      const aiResult = await aiService.generateCorrectionEmail({
        processCode: proc.processCode ?? String(processId),
        brand: proc.brand,
        invoiceNumber,
        exporterName: proc.exporterName ?? undefined,
        divergences,
      });
      subject = aiResult.subject;
      body = aiResult.body;
    } else {
      // Use the existing template
      const templateResult = kiomCorrectionTemplate({
        processCode: proc.processCode ?? String(processId),
        brand: proc.brand,
        failedChecks: failedResults.map((c) => ({
          checkName: c.checkName,
          expectedValue: c.expectedValue ?? undefined,
          actualValue: c.actualValue ?? undefined,
          message: c.message ?? '',
        })),
      });
      subject = templateResult.subject;
      body = templateResult.body;
    }

    // Create draft communication
    const communication = await this.create({
      processId,
      recipient: 'KIOM',
      recipientEmail: KIOM_EMAIL,
      subject,
      body,
    });

    logger.info(
      { processId, failedCount: failedResults.length, useAi, communicationId: communication.id },
      'Correction draft generated',
    );

    return communication;
  },

  async updateDraft(
    id: number,
    data: { subject?: string; body?: string; recipientEmail?: string },
  ) {
    const [communication] = await db
      .select()
      .from(communications)
      .where(eq(communications.id, id))
      .limit(1);

    if (!communication) throw new Error('Comunicacao nao encontrada');
    if (communication.status !== 'draft') throw new Error('Somente rascunhos podem ser editados');

    const updateData: Record<string, any> = {};
    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.body !== undefined) updateData.body = sanitizeHtml(data.body);
    if (data.recipientEmail !== undefined) updateData.recipientEmail = data.recipientEmail;

    const [updated] = await db
      .update(communications)
      .set(updateData)
      .where(eq(communications.id, id))
      .returning();

    return updated;
  },
};
