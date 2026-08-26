import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from '../../shared/utils/logger.js';

interface FetchedEmail {
  messageId: string;
  gmailId: string;
  from: string;
  subject: string;
  body: string;
  date: Date;
  attachments: Array<{
    filename: string;
    contentType: string;
    content: Buffer;
    size: number;
  }>;
}

function createClient() {
  const secure = process.env.IMAP_SECURE !== 'false';
  const rejectUnauthorized = process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false';

  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT) || 993,
    secure,
    auth: {
      user: process.env.IMAP_USER!,
      pass: process.env.IMAP_PASS!,
    },
    tls: {
      rejectUnauthorized,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    maxLineLength: 1024 * 1024,
    maxLiteralSize: 60 * 1024 * 1024,
    logger: false,
  });

  // ImapFlow can emit a socket error after connect()/logout() has already
  // rejected. Without an EventEmitter listener that late error terminates the
  // Node process, turning a degraded fallback into an API outage.
  client.on('error', (error) => {
    logger.warn({ err: error }, 'IMAP client emitted an asynchronous error');
  });

  return client;
}

export const imapService = {
  async fetchUnseenEmails(): Promise<FetchedEmail[]> {
    const client = createClient();
    const emails: FetchedEmail[] = [];

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        for await (const message of client.fetch(
          { seen: false },
          { source: true, envelope: true, uid: true },
        )) {
          try {
            if (!message.source) {
              logger.warn({ uid: message.uid }, 'Email has no source, skipping');
              continue;
            }

            const parsed = await simpleParser(message.source as Buffer);

            const attachments = (parsed.attachments || [])
              .filter((att: any) => {
                const ct = (att.contentType as string)?.toLowerCase() || '';
                const fn = (att.filename as string)?.toLowerCase() || '';
                return (
                  ct.includes('pdf') ||
                  ct.includes('excel') ||
                  ct.includes('spreadsheet') ||
                  fn.endsWith('.pdf') ||
                  fn.endsWith('.xlsx') ||
                  fn.endsWith('.xls')
                );
              })
              .map((att: any) => ({
                filename: (att.filename as string) || 'attachment',
                contentType: att.contentType as string,
                content: att.content as Buffer,
                size: att.size as number,
              }));

            const msgId = parsed.messageId || `${Date.now()}-${Math.random()}`;
            emails.push({
              messageId: msgId,
              gmailId: String(message.uid),
              from: parsed.from?.text || 'unknown',
              subject: parsed.subject || '(sem assunto)',
              body: parsed.text || '',
              date: parsed.date || new Date(),
              attachments,
            });
          } catch (parseErr) {
            logger.error({ err: parseErr, uid: message.uid }, 'Failed to parse email');
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (err) {
      logger.error({ err }, 'IMAP connection failed');
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
      client.close();
      throw err;
    }

    logger.info({ count: emails.length }, 'Fetched unseen emails');
    return emails;
  },

  async markAsRead(uid: string): Promise<void> {
    const client = createClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        await client.messageFlagsAdd(Number(uid), ['\\Seen'], { uid: true });
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      logger.error({ err, uid }, 'Failed to mark IMAP message as seen');
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
      client.close();
      throw err;
    }
  },

  async testConnection(): Promise<boolean> {
    const client = createClient();

    try {
      await client.connect();
      await client.logout();
      return true;
    } catch {
      return false;
    } finally {
      client.close();
    }
  },
};
