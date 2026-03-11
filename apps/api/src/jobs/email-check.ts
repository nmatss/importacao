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

/**
 * Double-check: re-reads all emails from today (including already-read ones)
 * to ensure nothing was missed during the day.
 * Runs once at 22:00 on weekdays.
 * Emails already in the DB (by messageId) are automatically skipped.
 */
export async function doubleCheckEmails() {
  const enabled = process.env.EMAIL_INGESTION_ENABLED === 'true';
  if (!enabled) return;

  if (isRunning) {
    logger.info('Email check already running, skipping double-check');
    return;
  }

  const gmailConfigured = !!(
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL
    && process.env.GOOGLE_DRIVE_PRIVATE_KEY
    && process.env.GMAIL_SHARED_MAILBOX
  );

  if (!gmailConfigured) {
    logger.info('Gmail API not configured, skipping double-check');
    return;
  }

  isRunning = true;
  try {
    // Build query for today's emails with attachments (all senders)
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}/${mm}/${dd}`;

    const gmailQuery = `has:attachment after:${todayStr}`;
    logger.info({ gmailQuery }, 'Running end-of-day email double-check (all senders, includeRead=true)');

    const { emailProcessor } = await import('../modules/email-ingestion/processor.js');
    await emailProcessor.processNewEmails(true, gmailQuery);

    logger.info('End-of-day email double-check completed');
  } catch (error) {
    logger.error({ error }, 'Email double-check job failed');
  } finally {
    isRunning = false;
  }
}
