import { eq, desc } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { db } from '../../shared/database/connection.js';
import { communications } from '../../shared/database/schema.js';
import { logger } from '../../shared/utils/logger.js';
import type { CreateCommunicationInput } from './schema.js';

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
  async list(processId?: number) {
    const query = db.select()
      .from(communications)
      .orderBy(desc(communications.createdAt));

    if (processId) {
      return query.where(eq(communications.processId, processId));
    }

    return query;
  },

  async create(input: CreateCommunicationInput) {
    const [communication] = await db.insert(communications).values({
      processId: input.processId,
      recipient: input.recipient,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      body: input.body,
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
        html: communication.body,
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
