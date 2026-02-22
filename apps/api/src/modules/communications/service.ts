import { eq, desc, count } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { db } from '../../shared/database/connection.js';
import { communications } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import type { CreateCommunicationInput } from './schema.js';

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
      await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: communication.recipientEmail,
        subject: communication.subject,
        html: sanitizeHtml(communication.body),
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
};
