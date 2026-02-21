import { logger } from '../shared/utils/logger.js';

let isRunning = false;

export async function checkEmails() {
  const enabled = process.env.EMAIL_INGESTION_ENABLED === 'true';
  if (!enabled) return;

  if (isRunning) {
    logger.debug('Email check already running, skipping');
    return;
  }

  // Check if at least one method is configured (Gmail API or IMAP)
  const gmailConfigured = !!(
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL
    && process.env.GOOGLE_DRIVE_PRIVATE_KEY
    && process.env.GMAIL_SHARED_MAILBOX
  );
  const imapConfigured = !!(process.env.IMAP_USER && process.env.IMAP_PASS);

  if (!gmailConfigured && !imapConfigured) return;

  isRunning = true;
  try {
    const { emailProcessor } = await import('../modules/email-ingestion/processor.js');
    await emailProcessor.processNewEmails();
  } catch (error) {
    logger.error({ error }, 'Email check job failed');
  } finally {
    isRunning = false;
  }
}
