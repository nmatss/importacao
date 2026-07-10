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
import {
  getOperationalRecipient,
  normalizeEmailList,
  parseEmailList,
} from '../settings/operational-recipients.js';

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

// Masks an email for logging/error messages: keeps the first char of the local
// part and the domain so an operator can recognize the address without leaking
// the full mailbox. e.g. "eduarda@kiom.com" -> "e***@kiom.com".
function maskEmail(value: string): string {
  const email = normalizeEmail(value);
  const at = email.indexOf('@');
  if (at <= 0) return email ? '***' : '';
  return `${email[0]}***${email.slice(at)}`;
}

function maskRecipientList(recipientEmail: string): string {
  const masked = parseEmailList(recipientEmail).map(maskEmail).filter(Boolean);
  return masked.length > 0 ? masked.join(', ') : '***';
}

/**
 * Builds the allow-list of recipient patterns.
 *
 * The configured operational recipients (kiom/fenicia/isa) are ALWAYS folded in
 * so that a communication addressed to a recipient resolved from settings/env is
 * accepted even when COMMUNICATION_ALLOWED_RECIPIENTS is empty. `parseEmailList`
 * already trims, lowercases, de-duplicates and drops empties, so an unconfigured
 * (empty string) operational recipient is skipped rather than poisoning the list.
 */
async function allowedRecipientPatterns(): Promise<string[]> {
  const [kiomEmail, feniciaEmail, isaEmail] = await Promise.all([
    getOperationalRecipient('kiom_email'),
    getOperationalRecipient('fenicia_email'),
    getOperationalRecipient('isa_email'),
  ]);

  return [kiomEmail, feniciaEmail, isaEmail, process.env.COMMUNICATION_ALLOWED_RECIPIENTS]
    .flatMap(parseEmailList)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Every outgoing operational email must include the fixed operational copy.
 *
 * This validation intentionally happens before SMTP work (and before the
 * send-error catch below) so a missing/malformed configuration never changes a
 * reviewable draft into a failed communication.
 */
async function getRequiredDefaultCcRecipients(): Promise<string> {
  const recipients = parseEmailList(await getOperationalRecipient('default_cc_email'));
  const normalizedRecipients = recipients.join(', ');

  if (
    recipients.length === 0 ||
    recipients.some((recipient) => !isValidEmailAddress(recipient)) ||
    normalizedRecipients.length > 500
  ) {
    throw new AppError(
      'Cópia operacional obrigatória não configurada. Cadastre um e-mail válido em "Configurações > E-mails > Destinatários operacionais".',
      503,
      'DEFAULT_CC_REQUIRED',
    );
  }

  return normalizedRecipients;
}

function matchesPattern(recipient: string, pattern: string): boolean {
  if (pattern.startsWith('@')) {
    const domain = pattern.slice(1);
    return recipient.endsWith(`@${domain}`) || recipient.endsWith(`.${domain}`);
  }
  if (pattern.includes('@')) return recipient === pattern;
  return recipient.endsWith(`@${pattern}`) || recipient.endsWith(`.${pattern}`);
}

interface RecipientCheckResult {
  allowed: boolean;
  patternCount: number;
}

async function isRecipientAllowed(recipientEmail: string): Promise<RecipientCheckResult> {
  const recipients = parseEmailList(recipientEmail).map(normalizeEmail);
  const patterns = await allowedRecipientPatterns();
  const patternCount = patterns.length;

  if (recipients.length === 0) return { allowed: false, patternCount };
  // Security property: with no patterns configured nothing is allowed. Configured
  // operational recipients are part of `patterns`, so they pass here naturally and
  // no arbitrary recipient is ever auto-allowed.
  if (patternCount === 0) return { allowed: false, patternCount };

  const allowed = recipients.every((recipient) =>
    patterns.some((pattern) => matchesPattern(recipient, pattern)),
  );

  return { allowed, patternCount };
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

  async create(input: CreateCommunicationInput, userId: number | null = null) {
    const recipientEmail = normalizeEmailList(input.recipientEmail);
    if (!recipientEmail) {
      throw new AppError(
        'E-mail do destinatário não configurado. Verifique Configurações > Destinatários operacionais.',
        400,
        'RECIPIENT_EMAIL_REQUIRED',
      );
    }

    const [communication] = await db
      .insert(communications)
      .values({
        processId: input.processId,
        recipient: input.recipient,
        recipientEmail,
        subject: input.subject,
        body: sanitizeHtml(input.body),
        attachments: input.attachments,
        status: 'draft',
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    const maskedRecipient = maskRecipientList(recipientEmail);
    await auditService.log(
      userId,
      'communication.created',
      'communication',
      communication.id,
      {
        processId: communication.processId,
        recipient: maskedRecipient,
        attachmentsCount: Array.isArray(input.attachments) ? input.attachments.length : 0,
      },
      null,
    );
    if (communication.processId) {
      await recordProcessEvent(
        communication.processId,
        {
          eventType: 'communication_created',
          title: `Rascunho de e-mail criado para ${maskedRecipient}`,
          metadata: { communicationId: communication.id, recipient: maskedRecipient },
        },
        userId,
      );
    }

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
        'E-mail do destinatário não configurado. Verifique Configurações > Destinatários operacionais.',
      );
    }

    const recipientCheck = await isRecipientAllowed(communication.recipientEmail);
    if (!recipientCheck.allowed) {
      const maskedRecipient = maskRecipientList(communication.recipientEmail);
      logger.warn(
        {
          communicationId: id,
          processId: communication.processId,
          recipient: maskedRecipient,
          allowedPatternCount: recipientCheck.patternCount,
        },
        'Envio bloqueado: destinatário fora da allow-list',
      );
      const reason =
        recipientCheck.patternCount === 0
          ? 'Nenhum destinatário autorizado está configurado.'
          : `Nenhum dos ${recipientCheck.patternCount} padrão(ões) autorizado(s) corresponde a este destinatário.`;
      throw new AppError(
        `Destinatário ${maskedRecipient} não autorizado para envio. ${reason} ` +
          'Cadastre o destinatário em "Configurações > Destinatários operacionais" ' +
          '(campos KIOM/Fenícia/ISA) ou defina a variável de ambiente ' +
          'COMMUNICATION_ALLOWED_RECIPIENTS com o e-mail ou domínio permitido.',
        403,
        'RECIPIENT_NOT_ALLOWED',
      );
    }

    // Fail closed: the operational copy is a required business control, not an
    // optional mail header. Keep the draft intact if the setting/env is absent
    // or malformed so the operator can retry after configuration is corrected.
    const defaultCc = await getRequiredDefaultCcRecipients();

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
      const sanitizeRecipientHeader = (v: string) =>
        normalizeEmailList(v)
          .replace(/[\r\n]/g, '')
          .trim();
      const ccHeader = sanitizeRecipientHeader(defaultCc);

      await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: sanitizeRecipientHeader(communication.recipientEmail),
        cc: ccHeader,
        subject: sanitizeHeader(communication.subject),
        html: sanitizeHtml(htmlBody),
        attachments: mailAttachments,
      });

      const sentAt = new Date();
      const [updated] = await db
        .update(communications)
        .set({
          status: 'sent',
          sentAt,
          sentBy: userId ?? null,
          updatedBy: userId ?? null,
          updatedAt: sentAt,
          ccRecipients: defaultCc,
        })
        .where(eq(communications.id, id))
        .returning();

      const maskedRecipient = maskRecipientList(communication.recipientEmail);
      const maskedCc = maskRecipientList(defaultCc);
      logger.info({ id, recipient: maskedRecipient, cc: maskedCc }, 'E-mail enviado com sucesso');
      await auditService.log(
        userId ?? null,
        'email.sent',
        'communication',
        updated.id,
        { recipient: maskedRecipient, ccRecipients: maskedCc },
        null,
      );

      // Record timeline event
      if (communication.processId) {
        await recordProcessEvent(
          communication.processId,
          {
            eventType: 'email_sent',
            title: `E-mail enviado para ${maskedRecipient}`,
            metadata: {
              communicationId: updated.id,
              recipient: maskedRecipient,
              ccRecipients: maskedCc,
            },
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

    const feniciaEmail = await getOperationalRecipient('fenicia_email');

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

    const kiomEmail = await getOperationalRecipient('kiom_email');

    // Create draft communication
    const communication = await this.create({
      processId,
      recipient: 'KIOM',
      recipientEmail: kiomEmail,
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
    data: {
      subject?: string;
      body?: string;
      recipient?: string;
      recipientEmail?: string;
      attachments?: unknown;
    },
    userId: number | null = null,
  ) {
    const [communication] = await db
      .select()
      .from(communications)
      .where(eq(communications.id, id))
      .limit(1);

    if (!communication) throw new Error('Comunicacao nao encontrada');
    // A failed send has never become a sent message. Keep it recoverable so the
    // operator can correct recipient/content/configuration and explicitly retry
    // instead of having to recreate a reviewable draft from scratch.
    if (communication.status !== 'draft' && communication.status !== 'failed') {
      throw new Error('Somente rascunhos ou envios com falha podem ser editados');
    }

    const updateData: Record<string, any> = {};
    const changedFields: string[] = [];
    if (data.recipient !== undefined) {
      updateData.recipient = data.recipient;
      changedFields.push('recipient');
    }
    if (data.subject !== undefined) {
      updateData.subject = data.subject;
      changedFields.push('subject');
    }
    if (data.body !== undefined) {
      updateData.body = sanitizeHtml(data.body);
      changedFields.push('body');
    }
    if (data.recipientEmail !== undefined) {
      const recipientEmail = normalizeEmailList(data.recipientEmail);
      if (!recipientEmail) {
        throw new AppError(
          'E-mail do destinatário não configurado. Verifique Configurações > Destinatários operacionais.',
          400,
          'RECIPIENT_EMAIL_REQUIRED',
        );
      }
      updateData.recipientEmail = recipientEmail;
      changedFields.push('recipientEmail');
    }
    if (data.attachments !== undefined) {
      updateData.attachments = data.attachments;
      changedFields.push('attachments');
    }
    updateData.updatedBy = userId;
    updateData.updatedAt = new Date();
    if (communication.status === 'failed') {
      updateData.status = 'draft';
      updateData.errorMessage = null;
      changedFields.push('reopenedAfterFailure');
    }

    const [updated] = await db
      .update(communications)
      .set(updateData)
      .where(eq(communications.id, id))
      .returning();

    const maskedRecipient = maskRecipientList(updated.recipientEmail);
    await auditService.log(
      userId,
      'communication.draft_updated',
      'communication',
      updated.id,
      { recipient: maskedRecipient, changedFields },
      null,
    );
    if (updated.processId) {
      await recordProcessEvent(
        updated.processId,
        {
          eventType: 'communication_draft_updated',
          title: `Rascunho de e-mail atualizado para ${maskedRecipient}`,
          metadata: { communicationId: updated.id, recipient: maskedRecipient, changedFields },
        },
        userId,
      );
    }

    return updated;
  },
};
