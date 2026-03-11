import { eq, desc, count } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { db } from '../../shared/database/connection.js';
import { communications, documents, importProcesses, espelhos, validationResults } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import type { CreateCommunicationInput } from './schema.js';
import { feniciaSubmissionTemplate } from './templates/fenicia-submission.js';
import { aiService } from '../ai/service.js';
import { kiomCorrectionTemplate } from './templates/kiom-correction.js';

const KIOM_EMAIL = process.env.KIOM_EMAIL || '';

function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove event handler attributes (onclick, onerror, onload, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: URLs
  clean = clean.replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '');
  clean = clean.replace(/src\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '');
  return clean;
}

function getSmtpTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export const communicationService = {
  async list(processId?: number, page = 1, limit = 20) {
    const conditions = processId ? eq(communications.processId, processId) : undefined;
    const offset = (page - 1) * limit;

    const [data, [{ total }]] = await Promise.all([
      db.select()
        .from(communications)
        .where(conditions)
        .orderBy(desc(communications.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(communications)
        .where(conditions),
    ]);

    return { data, total, page, limit };
  },

  async create(input: CreateCommunicationInput) {
    const [communication] = await db.insert(communications).values({
      processId: input.processId,
      recipient: input.recipient,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      body: sanitizeHtml(input.body),
      attachments: input.attachments,
      status: 'draft',
    }).returning();

    return communication;
  },

  async send(id: number) {
    const [communication] = await db.select()
      .from(communications)
      .where(eq(communications.id, id))
      .limit(1);

    if (!communication) throw new Error('Comunicação não encontrada');

    const transport = getSmtpTransport();

    try {
      // Build attachments list from DB record
      const dbAttachments = communication.attachments as Array<{ filename: string; path: string }> | null;
      const mailAttachments = dbAttachments?.map(att => ({
        filename: att.filename,
        path: att.path,
      }));

      await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: communication.recipientEmail,
        subject: communication.subject,
        html: sanitizeHtml(communication.body),
        attachments: mailAttachments,
      });

      const [updated] = await db.update(communications)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(communications.id, id))
        .returning();

      logger.info({ id, to: communication.recipientEmail }, 'E-mail enviado com sucesso');
      return updated;
    } catch (error: any) {
      await db.update(communications)
        .set({ status: 'failed', errorMessage: error.message })
        .where(eq(communications.id, id));

      logger.error({ id, error: error.message }, 'Falha ao enviar e-mail');
      throw new Error(`Falha ao enviar e-mail: ${error.message}`);
    }
  },

  async sendToFenicia(processId: number) {
    // Get process data
    const [proc] = await db.select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!proc) throw new Error('Processo não encontrado');

    // Get documents for attachments
    const docs = await db.select()
      .from(documents)
      .where(eq(documents.processId, processId));

    // Get latest espelho
    const [espelho] = await db.select()
      .from(espelhos)
      .where(eq(espelhos.processId, processId))
      .orderBy(desc(espelhos.createdAt))
      .limit(1);

    // Build attachments list
    const attachments: Array<{ filename: string; path: string }> = [];
    for (const doc of docs) {
      if (['invoice', 'packing_list', 'ohbl'].includes(doc.type)) {
        attachments.push({
          filename: doc.originalFilename,
          path: doc.storagePath,
        });
      }
    }

    if (espelho) {
      const espelhoData = espelho.generatedData as any;
      if (espelhoData?.filePath && espelhoData?.filename) {
        attachments.push({
          filename: espelhoData.filename,
          path: espelhoData.filePath,
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

    const feniciaEmail = process.env.FENICIA_EMAIL || 'fenicia@placeholder.com';

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
    const [proc] = await db.select()
      .from(importProcesses)
      .where(eq(importProcesses.id, processId))
      .limit(1);

    if (!proc) throw new Error('Processo nao encontrado');

    // Get all failed validation results
    const results = await db.select()
      .from(validationResults)
      .where(eq(validationResults.processId, processId));

    const failedResults = results.filter(r => r.status === 'failed' && !r.resolvedManually);

    if (failedResults.length === 0) {
      throw new Error('Nenhuma divergencia encontrada para gerar e-mail de correcao');
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

    const divergences = failedResults.map(r => ({
      checkName: r.checkName,
      category: categoryMap[r.checkName] || 'other',
      expectedValue: r.expectedValue ?? undefined,
      actualValue: r.actualValue ?? undefined,
      message: r.message ?? '',
    }));

    // Get invoice number from documents
    const docs = await db.select()
      .from(documents)
      .where(eq(documents.processId, processId));

    const invoiceDoc = docs.find(d => d.type === 'invoice');
    const invoiceData = invoiceDoc?.aiParsedData as Record<string, any> | null;
    const invoiceNumber = invoiceData?.invoiceNumber?.value || invoiceData?.invoice_number?.value || undefined;

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
        failedChecks: failedResults.map(c => ({
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
      recipientEmail: KIOM_EMAIL || 'kiom@placeholder.com',
      subject,
      body,
    });

    logger.info(
      { processId, failedCount: failedResults.length, useAi, communicationId: communication.id },
      'Correction draft generated',
    );

    return communication;
  },

  async updateDraft(id: number, data: { subject?: string; body?: string; recipientEmail?: string }) {
    const [communication] = await db.select()
      .from(communications)
      .where(eq(communications.id, id))
      .limit(1);

    if (!communication) throw new Error('Comunicacao nao encontrada');
    if (communication.status !== 'draft') throw new Error('Somente rascunhos podem ser editados');

    const updateData: Record<string, any> = {};
    if (data.subject) updateData.subject = data.subject;
    if (data.body) updateData.body = sanitizeHtml(data.body);
    if (data.recipientEmail) updateData.recipientEmail = data.recipientEmail;

    const [updated] = await db.update(communications)
      .set(updateData)
      .where(eq(communications.id, id))
      .returning();

    return updated;
  },
};
