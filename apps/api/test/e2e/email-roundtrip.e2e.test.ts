import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import nodemailer from 'nodemailer';
import postgres from 'postgres';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  handleE2ESetupFailure,
  setupE2EDatabase,
  signTestToken,
  type E2EContext,
} from './setup.js';

const GREENMAIL_IMAGE = 'greenmail/standalone:2.1.13';
const GREENMAIL_SMTP_PORT = 3025;
const GREENMAIL_IMAPS_PORT = 3993;
const TEST_MAILBOX = 'inbox@example.com';
const TEST_PASSWORD = 'e2e-only-password';

let dbContext: E2EContext;
let mailContainer: StartedTestContainer;
let skipReason: string | null = null;

const originalMailEnv = {
  IMAP_HOST: process.env.IMAP_HOST,
  IMAP_PORT: process.env.IMAP_PORT,
  IMAP_SECURE: process.env.IMAP_SECURE,
  IMAP_TLS_REJECT_UNAUTHORIZED: process.env.IMAP_TLS_REJECT_UNAUTHORIZED,
  IMAP_USER: process.env.IMAP_USER,
  IMAP_PASS: process.env.IMAP_PASS,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_TLS_REJECT_UNAUTHORIZED: process.env.SMTP_TLS_REJECT_UNAUTHORIZED,
  COMMUNICATION_ALLOWED_RECIPIENTS: process.env.COMMUNICATION_ALLOWED_RECIPIENTS,
  COMMUNICATION_DEFAULT_CC: process.env.COMMUNICATION_DEFAULT_CC,
  EMAIL_ALLOWED_SENDERS: process.env.EMAIL_ALLOWED_SENDERS,
  EMAIL_PROCESSING_STALE_MINUTES: process.env.EMAIL_PROCESSING_STALE_MINUTES,
  GOOGLE_DRIVE_CLIENT_EMAIL: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
  GOOGLE_DRIVE_PRIVATE_KEY: process.env.GOOGLE_DRIVE_PRIVATE_KEY,
  DOCUMENT_SOURCE: process.env.DOCUMENT_SOURCE,
};

function restoreMailEnvironment(): void {
  for (const [key, value] of Object.entries(originalMailEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeAll(async () => {
  try {
    [dbContext, mailContainer] = await Promise.all([
      setupE2EDatabase(),
      new GenericContainer(GREENMAIL_IMAGE)
        .withEnvironment({
          GREENMAIL_ADDITIONAL_OPTS: `-Dgreenmail.users=inbox:${TEST_PASSWORD}@example.com`,
        })
        .withExposedPorts(GREENMAIL_SMTP_PORT, GREENMAIL_IMAPS_PORT)
        .withWaitStrategy(Wait.forListeningPorts())
        .withStartupTimeout(120_000)
        .start(),
    ]);

    const host = mailContainer.getHost();
    process.env.IMAP_HOST = host;
    process.env.IMAP_PORT = String(mailContainer.getMappedPort(GREENMAIL_IMAPS_PORT));
    process.env.IMAP_SECURE = 'true';
    // GreenMail's certificate is intentionally self-signed. This exception is
    // scoped to the sandbox container and the production default remains true.
    process.env.IMAP_TLS_REJECT_UNAUTHORIZED = 'false';
    process.env.IMAP_USER = 'inbox';
    process.env.IMAP_PASS = TEST_PASSWORD;

    process.env.SMTP_HOST = host;
    process.env.SMTP_PORT = String(mailContainer.getMappedPort(GREENMAIL_SMTP_PORT));
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = '';
    process.env.SMTP_PASS = '';
    process.env.SMTP_FROM = '"Uni.co E2E" <sender@example.com>';
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED = 'false';
    process.env.COMMUNICATION_ALLOWED_RECIPIENTS = TEST_MAILBOX;
    process.env.COMMUNICATION_DEFAULT_CC = 'archive@example.com';
    process.env.EMAIL_ALLOWED_SENDERS = 'example.com';
    process.env.EMAIL_PROCESSING_STALE_MINUTES = '30';
    // Force this isolated suite through IMAP even if the shell that launched
    // Vitest happens to export real Google credentials.
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = '';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = '';
    // This suite deliberately verifies the historical e-mail path. Production
    // defaults to Drive-only and exercises that gate in documents.e2e.
    process.env.DOCUMENT_SOURCE = 'email';
  } catch (err) {
    skipReason = handleE2ESetupFailure(err);
  }
}, 120_000);

afterAll(async () => {
  restoreMailEnvironment();
  await Promise.allSettled([mailContainer?.stop(), dbContext?.cleanup()]);
});

describe('Email SMTP/IMAP round-trip E2E', () => {
  it('receives an external SMTP message with a PDF and marks it as read over IMAPS', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }

    const subject = `Inbound E2E ${Date.now()}`;
    const smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
    });

    try {
      await smtp.sendMail({
        from: 'partner@example.com',
        to: TEST_MAILBOX,
        subject,
        text: 'Documento de importação para processamento.',
        attachments: [
          {
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            content: Buffer.from('%PDF-1.4\n% E2E fixture\n%%EOF'),
          },
        ],
      });
    } finally {
      smtp.close();
    }

    const { imapService } = await import('../../src/modules/email-ingestion/imap.service.js');
    expect(await imapService.testConnection()).toBe(true);

    const emails = await imapService.fetchUnseenEmails();
    const received = emails.find((email) => email.subject === subject);
    expect(received).toMatchObject({
      from: expect.stringContaining('partner@example.com'),
      body: expect.stringContaining('Documento de importação'),
    });
    expect(received?.attachments).toHaveLength(1);
    expect(received?.attachments[0]).toMatchObject({
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
    });

    await imapService.markAsRead(received!.gmailId);
    const unseenAfterMarking = await imapService.fetchUnseenEmails();
    expect(unseenAfterMarking.some((email) => email.subject === subject)).toBe(false);
  });

  it('creates, sanitizes and sends a communication through the application SMTP path', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }

    const { app } = await import('../../src/app.js');
    const { imapService } = await import('../../src/modules/email-ingestion/imap.service.js');
    const token = signTestToken();
    const subject = `Outbound E2E ${Date.now()}`;

    const created = await request(app)
      .post('/api/communications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipient: 'Caixa E2E',
        recipientEmail: TEST_MAILBOX,
        subject,
        body: '<p style="padding: 8px" onclick="alert(1)">Conteúdo seguro</p><script>alert(2)</script>',
      });

    expect(created.status).toBe(201);
    expect(created.body.data.body).toContain('Conteúdo seguro');
    expect(created.body.data.body).not.toMatch(/onclick|script|alert/i);

    const sent = await request(app)
      .post(`/api/communications/${created.body.data.id}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({
      status: 'sent',
      ccRecipients: expect.stringContaining('global@grupounico.com'),
    });

    const emails = await imapService.fetchUnseenEmails();
    const received = emails.find((email) => email.subject === subject);
    expect(received).toMatchObject({
      body: expect.stringContaining('Conteúdo seguro'),
    });
    expect(received?.body).not.toMatch(/alert|script/i);

    await imapService.markAsRead(received!.gmailId);
  });

  it('rejects malformed communication IDs, pagination, dates and send payloads', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }

    const { app } = await import('../../src/app.js');
    const authorization = { Authorization: `Bearer ${signTestToken()}` };

    const [invalidId, invalidPage, invalidDateRange, unexpectedSendField] = await Promise.all([
      request(app).post('/api/communications/not-a-number/send').set(authorization).send({}),
      request(app).get('/api/communications?page=-1&limit=1000').set(authorization),
      request(app)
        .get('/api/communications?startDate=2026-02-30&endDate=2026-01-01')
        .set(authorization),
      request(app)
        .post('/api/communications/1/send')
        .set(authorization)
        .send({ recipientEmail: 'attacker@example.com' }),
    ]);

    for (const response of [invalidId, invalidPage, invalidDateRange, unexpectedSendField]) {
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ success: false, error: 'Dados inválidos' });
    }
  });

  it('resumes an abandoned ingestion lease but never acknowledges an active one', async () => {
    if (skipReason) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }

    const staleMessageId = `<stale-${Date.now()}@example.test>`;
    const activeMessageId = `<active-${Date.now()}@example.test>`;
    const smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
    });

    try {
      await Promise.all([
        smtp.sendMail({
          from: 'partner@example.com',
          to: TEST_MAILBOX,
          messageId: staleMessageId,
          subject: 'Lease abandonada E2E',
          text: 'Sem anexos para encerrar de forma determinística.',
        }),
        smtp.sendMail({
          from: 'partner@example.com',
          to: TEST_MAILBOX,
          messageId: activeMessageId,
          subject: 'Lease ativa E2E',
          text: 'Esta mensagem deve permanecer não lida.',
        }),
      ]);
    } finally {
      smtp.close();
    }

    const sql = postgres(dbContext.connectionString, { max: 1 });
    try {
      await sql`
        INSERT INTO email_ingestion_logs
          (message_id, from_address, subject, received_at, status, attachments_count, updated_at)
        VALUES
          (${staleMessageId}, 'partner@example.com', 'Lease abandonada E2E', NOW(), 'processing', 0, NOW() - INTERVAL '2 hours'),
          (${activeMessageId}, 'partner@example.com', 'Lease ativa E2E', NOW(), 'processing', 0, NOW())
      `;

      const { emailProcessor } = await import('../../src/modules/email-ingestion/processor.js');
      const { imapService } = await import('../../src/modules/email-ingestion/imap.service.js');
      await emailProcessor.processNewEmails();

      const rows = await sql<{ message_id: string; status: string }[]>`
        SELECT message_id, status
        FROM email_ingestion_logs
        WHERE message_id IN (${staleMessageId}, ${activeMessageId})
      `;
      expect(Object.fromEntries(rows.map((row) => [row.message_id, row.status]))).toEqual({
        [staleMessageId]: 'ignored',
        [activeMessageId]: 'processing',
      });

      const unseen = await imapService.fetchUnseenEmails();
      expect(unseen.some((email) => email.messageId === staleMessageId)).toBe(false);
      const active = unseen.find((email) => email.messageId === activeMessageId);
      expect(active).toBeDefined();
      await imapService.markAsRead(active!.gmailId);
    } finally {
      await sql.end();
    }
  });
});
