import { logger } from '../shared/utils/logger.js';
import {
  getDocumentSource,
  isEmailIngestionEnabled,
} from '../modules/documents/drive-ingestion.service.js';

let isRunning = false;

function buildAllowedSenderFilter(): string | null {
  const allowedSenders =
    process.env.EMAIL_ALLOWED_SENDERS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) || [];
  if (allowedSenders.length === 0) return null;
  return `{${allowedSenders.map((s) => `from:${s}`).join(' ')}}`;
}

export async function checkEmails() {
  const enabled = process.env.EMAIL_INGESTION_ENABLED === 'true';
  if (!enabled) return;

  // DOCUMENT_SOURCE=drive means the process folder in Drive is the only source
  // the team wants trusted for now; e-mail ingestion stands down without
  // needing EMAIL_INGESTION_ENABLED to be flipped (and later restored).
  if (!isEmailIngestionEnabled()) {
    logger.debug({ source: getDocumentSource() }, 'Email ingestion off via DOCUMENT_SOURCE');
    return;
  }

  if (isRunning) {
    logger.debug('Email check already running, skipping');
    return;
  }

  // Check if at least one method is configured (Gmail API or IMAP)
  // O mailbox sempre resolve via fallback padrão; só as credenciais gateiam.
  const gmailConfigured = !!(
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY
  );
  const imapConfigured = !!(process.env.IMAP_USER && process.env.IMAP_PASS);

  if (!gmailConfigured && !imapConfigured) return;

  // Fail closed like every other scan path: without an allow-list the Gmail
  // query degrades to "is:unread has:attachment" over a shared corporate
  // mailbox, and unrelated correspondence would be downloaded and marked read.
  if (!buildAllowedSenderFilter()) {
    logger.warn('Skipping email check: EMAIL_ALLOWED_SENDERS is not configured');
    return;
  }

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

  // DOCUMENT_SOURCE=drive means the process folder in Drive is the only source
  // the team wants trusted for now; e-mail ingestion stands down without
  // needing EMAIL_INGESTION_ENABLED to be flipped (and later restored).
  if (!isEmailIngestionEnabled()) {
    logger.debug({ source: getDocumentSource() }, 'Email ingestion off via DOCUMENT_SOURCE');
    return;
  }

  if (isRunning) {
    logger.info('Email check already running, skipping double-check');
    return;
  }

  // O mailbox sempre resolve via fallback padrão; só as credenciais gateiam.
  const gmailConfigured = !!(
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY
  );

  if (!gmailConfigured) {
    logger.info('Gmail API not configured, skipping double-check');
    return;
  }

  isRunning = true;
  try {
    // Build query for today's emails with attachments, still constrained by
    // EMAIL_ALLOWED_SENDERS. Sender allowlist is fail-closed across all scans.
    const senderFilter = buildAllowedSenderFilter();
    if (!senderFilter) {
      logger.warn('Skipping double-check: EMAIL_ALLOWED_SENDERS is not configured');
      return;
    }
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}/${mm}/${dd}`;

    const gmailQuery = `has:attachment after:${todayStr} ${senderFilter}`;
    logger.info({ gmailQuery }, 'Running end-of-day email double-check (includeRead=true)');

    const { emailProcessor } = await import('../modules/email-ingestion/processor.js');
    await emailProcessor.processNewEmails(true, gmailQuery);

    logger.info('End-of-day email double-check completed');
  } catch (error) {
    logger.error({ error }, 'Email double-check job failed');
  } finally {
    isRunning = false;
  }
}
