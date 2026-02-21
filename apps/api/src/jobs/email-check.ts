import { logger } from '../shared/utils/logger.js';

export async function checkEmails() {
  const enabled = process.env.EMAIL_INGESTION_ENABLED === 'true';
  if (!enabled) return;

  // Check if at least one method is configured (Gmail API or IMAP)
  const gmailConfigured = !!(
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL
    && process.env.GOOGLE_DRIVE_PRIVATE_KEY
    && process.env.GMAIL_SHARED_MAILBOX
  );
  const imapConfigured = !!(process.env.IMAP_USER && process.env.IMAP_PASS);

  if (!gmailConfigured && !imapConfigured) return;

  try {
    const { emailProcessor } = await import('../modules/email-ingestion/processor.js');
    await emailProcessor.processNewEmails();
  } catch (error) {
    logger.error({ error }, 'Email check job failed');
  }
}
