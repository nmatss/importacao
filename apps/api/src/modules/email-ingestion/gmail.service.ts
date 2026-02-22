import { gmail_v1, auth as googleAuth } from '@googleapis/gmail';
import { logger } from '../../shared/utils/logger.js';

export interface FetchedEmail {
  messageId: string;
  from: string;
  subject: string;
  date: Date;
  attachments: Array<{
    filename: string;
    contentType: string;
    content: Buffer;
    size: number;
  }>;
}

let gmailClient: gmail_v1.Gmail | null = null;

function getGmailClient(): gmail_v1.Gmail {
  if (gmailClient) return gmailClient;

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const sharedMailbox = process.env.GMAIL_SHARED_MAILBOX;

  if (!clientEmail || !privateKey) {
    throw new Error('Google service account credentials not configured (GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY)');
  }

  if (!sharedMailbox) {
    throw new Error('GMAIL_SHARED_MAILBOX not configured - set the shared mailbox email address');
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
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function findAttachmentParts(
  parts: gmail_v1.Schema$MessagePart[] | undefined,
): Array<{ partId: string; filename: string; mimeType: string; bodyAttachmentId: string; size: number }> {
  const attachments: Array<{ partId: string; filename: string; mimeType: string; bodyAttachmentId: string; size: number }> = [];

  if (!parts) return attachments;

  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      const mime = (part.mimeType || '').toLowerCase();
      const fname = part.filename.toLowerCase();

      // Only process PDF and Excel files
      if (mime.includes('pdf') || mime.includes('excel') || mime.includes('spreadsheet')
        || fname.endsWith('.pdf') || fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
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
  async fetchUnseenEmails(includeRead = false): Promise<FetchedEmail[]> {
    const gmail = getGmailClient();
    const emails: FetchedEmail[] = [];

    // Build search query from EMAIL_ALLOWED_SENDERS
    const allowedSenders = process.env.EMAIL_ALLOWED_SENDERS
      ?.split(',').map(s => s.trim()).filter(Boolean) || [];
    const fromFilter = allowedSenders.length > 0
      ? `{${allowedSenders.map(s => `from:${s}`).join(' ')}}`
      : '';
    const unreadFilter = includeRead ? '' : 'is:unread';
    const searchQuery = `${unreadFilter} has:attachment ${fromFilter}`.trim();

    logger.info({ searchQuery }, 'Gmail search query');

    try {
      // List unread messages with pagination to fetch ALL
      const allMessageIds: gmail_v1.Schema$Message[] = [];
      let pageToken: string | undefined;

      do {
        const listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: searchQuery,
          maxResults: 100,
          pageToken,
        });

        const messages = listResponse.data.messages || [];
        allMessageIds.push(...messages);
        pageToken = listResponse.data.nextPageToken ?? undefined;
      } while (pageToken);

      const messageIds = allMessageIds;

      if (messageIds.length === 0) {
        logger.debug('No unread emails with attachments found');
        return emails;
      }

      logger.info({ count: messageIds.length }, 'Found unread emails with attachments');

      for (const msg of messageIds) {
        try {
          // Get full message
          const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'full',
          });

          const headers = fullMessage.data.payload?.headers || [];
          const from = extractHeader(headers, 'From');
          const subject = extractHeader(headers, 'Subject');
          const dateStr = extractHeader(headers, 'Date');
          const messageId = extractHeader(headers, 'Message-ID') || msg.id!;

          // Find attachment parts
          const attachmentParts = findAttachmentParts(
            fullMessage.data.payload?.parts || (fullMessage.data.payload ? [fullMessage.data.payload] : []),
          );

          // Download attachments
          const attachments: FetchedEmail['attachments'] = [];

          for (const att of attachmentParts) {
            try {
              const attachmentData = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: msg.id!,
                id: att.bodyAttachmentId,
              });

              if (attachmentData.data.data) {
                attachments.push({
                  filename: att.filename,
                  contentType: att.mimeType,
                  content: decodeBase64Url(attachmentData.data.data),
                  size: attachmentData.data.size || att.size,
                });
              }
            } catch (attErr) {
              logger.error({ err: attErr, filename: att.filename }, 'Failed to download attachment');
            }
          }

          emails.push({
            messageId,
            from,
            subject,
            date: dateStr ? new Date(dateStr) : new Date(),
            attachments,
          });

          // Mark as read
          await gmail.users.messages.modify({
            userId: 'me',
            id: msg.id!,
            requestBody: {
              removeLabelIds: ['UNREAD'],
            },
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

  async testConnection(): Promise<boolean> {
    try {
      const gmail = getGmailClient();
      const sharedMailbox = process.env.GMAIL_SHARED_MAILBOX!;

      const profile = await gmail.users.getProfile({ userId: sharedMailbox });
      logger.info({ email: profile.data.emailAddress }, 'Gmail API connection successful');
      return true;
    } catch (err) {
      logger.error({ err }, 'Gmail API connection test failed');
      return false;
    }
  },

  isConfigured(): boolean {
    return !!(
      process.env.GOOGLE_DRIVE_CLIENT_EMAIL
      && process.env.GOOGLE_DRIVE_PRIVATE_KEY
      && process.env.GMAIL_SHARED_MAILBOX
    );
  },
};
