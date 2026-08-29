import { gmail_v1, auth as googleAuth } from '@googleapis/gmail';
import { AppError } from '../../shared/errors/index.js';
import { normalizeGooglePrivateKey } from '../../shared/utils/google-private-key.js';
import { logger } from '../../shared/utils/logger.js';

const GMAIL_API_TIMEOUT_MS = 30_000;
export const DEFAULT_GMAIL_SHARED_MAILBOX = 'global@grupounico.com';

/** Sender allow-list, shared by the search builder and by `getStatus()`. */
export function resolveAllowedSenders(): string[] {
  return (
    process.env.EMAIL_ALLOWED_SENDERS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) || []
  );
}

/**
 * Reads a per-run ceiling from the environment.
 *
 * The mailbox is shared and corporate: an unbounded `do/while(pageToken)` plus
 * an unbounded attachment budget means one poll can list every message in the
 * box and hold every attachment in memory at once. Whatever these ceilings cut
 * is simply left unread, so the next run picks it up — nothing is lost.
 */
function positiveEnvNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Gmail API timeout after 30s: ${label}`)),
      GMAIL_API_TIMEOUT_MS,
    ),
  );
  return Promise.race([promise, timeout]);
}

export interface FetchedEmail {
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

let gmailClient: gmail_v1.Gmail | null = null;

export function resolveSharedMailbox(): string {
  return process.env.GMAIL_SHARED_MAILBOX || DEFAULT_GMAIL_SHARED_MAILBOX;
}

function getGmailClient(): gmail_v1.Gmail {
  if (gmailClient) return gmailClient;

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = normalizeGooglePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY);
  const sharedMailbox = resolveSharedMailbox();

  if (!clientEmail || !privateKey) {
    throw new Error(
      'Google service account credentials not configured (GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY)',
    );
  }

  if (!process.env.GMAIL_SHARED_MAILBOX) {
    // Fallback intencional (feedback 2026-07-09), mas ambientes de teste com
    // credenciais Google reais passariam a ler a caixa de produção — avisar.
    logger.warn(
      { sharedMailbox },
      'GMAIL_SHARED_MAILBOX não configurado — usando mailbox compartilhado padrão',
    );
  }

  const jwtClient = new googleAuth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    subject: sharedMailbox, // Impersonate the shared mailbox
  });

  gmailClient = new gmail_v1.Gmail({ auth: jwtClient });
  return gmailClient;
}

function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function extractHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // If the payload itself has body data (simple messages)
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data).toString('utf-8');
  }

  // For multipart messages, search parts recursively
  if (payload.parts) {
    // Prefer text/plain over text/html
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data).toString('utf-8');
      }
    }
    // Fallback to text/html (strip tags roughly)
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data).toString('utf-8');
        return html
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const text = extractBodyText(part);
        if (text) return text;
      }
    }
  }

  return '';
}

function findAttachmentParts(parts: gmail_v1.Schema$MessagePart[] | undefined): Array<{
  partId: string;
  filename: string;
  mimeType: string;
  bodyAttachmentId: string;
  size: number;
}> {
  const attachments: Array<{
    partId: string;
    filename: string;
    mimeType: string;
    bodyAttachmentId: string;
    size: number;
  }> = [];

  if (!parts) return attachments;

  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      const mime = (part.mimeType || '').toLowerCase();
      const fname = part.filename.toLowerCase();

      // Only process PDF and Excel files
      if (
        mime.includes('pdf') ||
        mime.includes('excel') ||
        mime.includes('spreadsheet') ||
        fname.endsWith('.pdf') ||
        fname.endsWith('.xlsx') ||
        fname.endsWith('.xls')
      ) {
        attachments.push({
          partId: part.partId || '',
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          bodyAttachmentId: part.body.attachmentId,
          size: part.body.size || 0,
        });
      }
    }

    // Recurse into nested parts (multipart messages)
    if (part.parts) {
      attachments.push(...findAttachmentParts(part.parts));
    }
  }

  return attachments;
}

export const gmailService = {
  async fetchUnseenEmails(includeRead = false, queryOverride?: string): Promise<FetchedEmail[]> {
    const gmail = getGmailClient();
    const emails: FetchedEmail[] = [];

    let searchQuery: string;
    let senderFilterConfigured = false;
    if (queryOverride) {
      searchQuery = queryOverride;
    } else {
      // Build search query from EMAIL_ALLOWED_SENDERS.
      //
      // FAIL CLOSED: without an allow-list the query collapses to
      // "is:unread has:attachment", which lists every unrelated message of a
      // shared corporate mailbox, downloads all of its attachments and — once
      // the processor rejects the sender — marks them as READ. That is
      // destructive and the system cannot undo it. `doubleCheckEmails`,
      // `triggerCheck` and `historyScan` already abort in this situation; the
      // 5-minute cron was the only path that did not.
      const allowedSenders = resolveAllowedSenders();
      if (allowedSenders.length === 0) {
        throw new AppError(
          'EMAIL_ALLOWED_SENDERS deve estar configurado para ler a caixa compartilhada',
          503,
          'EMAIL_ALLOWED_SENDERS_NOT_CONFIGURED',
        );
      }
      senderFilterConfigured = true;
      const fromFilter = `{${allowedSenders.map((s) => `from:${s}`).join(' ')}}`;
      const unreadFilter = includeRead ? '' : 'is:unread';
      // Default date limit: fetch emails from last 180 days (6 months) for complete history
      const dateLimit = includeRead ? 'newer_than:180d' : '';
      searchQuery = `${unreadFilter} ${dateLimit} has:attachment ${fromFilter}`
        .replace(/\s+/g, ' ')
        .trim();
    }

    // The query can embed sender addresses and a subject during reprocessing.
    // Log only operational shape, never mailbox content or personal data.
    logger.info(
      {
        includeRead,
        customQuery: Boolean(queryOverride),
        senderFilterConfigured,
      },
      'Gmail search prepared',
    );

    const maxPages = positiveEnvNumber('GMAIL_MAX_PAGES_PER_RUN', 10);
    const maxMessages = positiveEnvNumber('GMAIL_MAX_MESSAGES_PER_RUN', 500);
    const maxTotalBytes = positiveEnvNumber('EMAIL_ATTACHMENT_TOTAL_MAX_BYTES', 200 * 1024 * 1024);

    try {
      // List messages with bounded pagination. Whatever the ceiling leaves out
      // stays unread and is picked up by the next run.
      const allMessageIds: gmail_v1.Schema$Message[] = [];
      let pageToken: string | undefined;
      let pages = 0;

      do {
        const listResponse = await withTimeout(
          gmail.users.messages.list({
            userId: 'me',
            q: searchQuery,
            maxResults: 100,
            pageToken,
          }),
          'messages.list',
        );

        const messages = listResponse.data.messages || [];
        allMessageIds.push(...messages);
        pageToken = listResponse.data.nextPageToken ?? undefined;
        pages += 1;

        if (pageToken && pages >= maxPages) {
          logger.warn(
            { pages, maxPages, listed: allMessageIds.length },
            'Gmail pagination ceiling reached — remaining pages stay unread for the next run',
          );
          break;
        }
      } while (pageToken);

      let messageIds = allMessageIds;

      if (messageIds.length > maxMessages) {
        logger.warn(
          { listed: messageIds.length, maxMessages },
          'Gmail message ceiling reached — surplus messages stay unread for the next run',
        );
        messageIds = messageIds.slice(0, maxMessages);
      }

      if (messageIds.length === 0) {
        logger.debug('No unread emails with attachments found');
        return emails;
      }

      logger.info({ count: messageIds.length }, 'Found unread emails with attachments');

      let totalAttachmentBytes = 0;

      for (const msg of messageIds) {
        // Aggregate memory budget. Checked BETWEEN messages so a message is
        // never fetched with only part of its attachments: a truncated message
        // would be logged, acknowledged and marked read with data missing.
        if (totalAttachmentBytes >= maxTotalBytes) {
          logger.warn(
            { totalAttachmentBytes, maxTotalBytes, fetched: emails.length },
            'Aggregate attachment budget reached — remaining messages stay unread for the next run',
          );
          break;
        }

        try {
          // Get full message
          const fullMessage = await withTimeout(
            gmail.users.messages.get({
              userId: 'me',
              id: msg.id!,
              format: 'full',
            }),
            `messages.get(${msg.id})`,
          );

          const headers = fullMessage.data.payload?.headers || [];
          const from = extractHeader(headers, 'From');
          const subject = extractHeader(headers, 'Subject');
          const dateStr = extractHeader(headers, 'Date');
          const messageId = extractHeader(headers, 'Message-ID') || msg.id!;

          // Find attachment parts
          const attachmentParts = findAttachmentParts(
            fullMessage.data.payload?.parts ||
              (fullMessage.data.payload ? [fullMessage.data.payload] : []),
          );

          // Download attachments
          const attachments: FetchedEmail['attachments'] = [];

          for (const att of attachmentParts) {
            try {
              const attachmentData = await withTimeout(
                gmail.users.messages.attachments.get({
                  userId: 'me',
                  messageId: msg.id!,
                  id: att.bodyAttachmentId,
                }),
                `attachments.get(${att.filename})`,
              );

              if (attachmentData.data.data) {
                const content = decodeBase64Url(attachmentData.data.data);
                totalAttachmentBytes += content.length;
                attachments.push({
                  filename: att.filename,
                  contentType: att.mimeType,
                  content,
                  size: attachmentData.data.size || att.size,
                });
              }
            } catch (attErr) {
              logger.error(
                { err: attErr, filename: att.filename },
                'Failed to download attachment',
              );
            }
          }

          const body = extractBodyText(fullMessage.data.payload);

          emails.push({
            messageId,
            gmailId: msg.id!,
            from,
            subject,
            body,
            date: dateStr ? new Date(dateStr) : new Date(),
            attachments,
          });
        } catch (msgErr) {
          logger.error({ err: msgErr, messageId: msg.id }, 'Failed to process Gmail message');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Gmail API request failed');
      throw err;
    }

    logger.info({ count: emails.length }, 'Fetched unread emails via Gmail API');
    return emails;
  },

  async markAsRead(gmailId: string): Promise<void> {
    const gmail = getGmailClient();
    await withTimeout(
      gmail.users.messages.modify({
        userId: 'me',
        id: gmailId,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      }),
      `messages.modify(${gmailId})`,
    );
  },

  async testConnection(): Promise<boolean> {
    try {
      const gmail = getGmailClient();
      const sharedMailbox = resolveSharedMailbox();

      await withTimeout(gmail.users.getProfile({ userId: sharedMailbox }), 'getProfile');
      logger.info('Gmail API connection successful');
      return true;
    } catch (err) {
      logger.error({ err }, 'Gmail API connection test failed');
      return false;
    }
  },

  // O mailbox sempre resolve (fallback padrão); só as credenciais gateiam.
  isConfigured(): boolean {
    return !!(process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY);
  },
};
