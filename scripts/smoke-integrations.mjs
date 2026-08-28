#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The container normally defines LOG_LEVEL=info. Override it for this sanitized
// diagnostic so imported services cannot add provider/runtime log lines to the
// machine-readable output.
process.env.LOG_LEVEL = 'fatal';

const networkEnabled = process.argv.includes('--network');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const distRoot = [resolve(scriptDir, '../apps/api/dist'), resolve(scriptDir, '../dist')].find(
  existsSync,
);

function configured(name) {
  return Boolean(process.env[name]?.trim());
}

function result(check, ok, details = {}) {
  console.log(JSON.stringify({ check, ok, ...details }));
}

function errorCode(error) {
  const raw = error?.code ?? error?.response?.status ?? error?.status;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^[A-Z0-9_-]{1,40}$/i.test(raw)) return raw;
  return 'unknown';
}

function validChatWebhook() {
  const value = process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chat.googleapis.com';
  } catch {
    return false;
  }
}

const documentSource = process.env.DOCUMENT_SOURCE || 'drive';
const referenceSource = process.env.PROCESS_REFERENCE_SOURCE || 'follow_up';
const emailIngestionEnabled = process.env.EMAIL_INGESTION_ENABLED === 'true';
const gmailConfigured =
  configured('GOOGLE_DRIVE_CLIENT_EMAIL') && configured('GOOGLE_DRIVE_PRIVATE_KEY');
const imapConfigured = configured('IMAP_USER') && configured('IMAP_PASS');
const smtpConfigured = configured('SMTP_HOST');
const driveConfigured = gmailConfigured && configured('GOOGLE_DRIVE_ROOT_FOLDER_ID');
const followUpConfigured = gmailConfigured && configured('GOOGLE_SHEETS_FOLLOW_UP_ID');

result('configuration', true, {
  emailIngestionEnabled,
  documentSource,
  referenceSource,
  gmailConfigured,
  imapConfigured,
  smtpConfigured,
  driveConfigured,
  followUpConfigured,
  preConsDriveConfigured: configured('GOOGLE_DRIVE_PRE_CONS_FOLDER_ID'),
  googleChatWebhookValid: validChatWebhook(),
});

if (!networkEnabled) process.exit(0);
if (!distRoot) {
  result('compiled-api', false, { reason: 'dist_not_found' });
  process.exit(1);
}

const importCompiled = (relativePath) =>
  import(pathToFileURL(resolve(distRoot, relativePath)).href);

let gmailOk = false;
let imapOk = false;
let smtpOk = false;
let driveOk = false;
let followUpOk = false;

if (gmailConfigured) {
  const { gmailService } = await importCompiled('modules/email-ingestion/gmail.service.js');
  gmailOk = await gmailService.testConnection();
  result('gmail-read-profile', gmailOk);
} else {
  result('gmail-read-profile', false, { reason: 'not_configured' });
}

if (imapConfigured) {
  const { imapService } = await importCompiled('modules/email-ingestion/imap.service.js');
  imapOk = await imapService.testConnection();
  result('imap-authentication', imapOk);
} else {
  result('imap-authentication', false, { reason: 'not_configured' });
}

if (smtpConfigured) {
  try {
    const { verifySmtpConnection } = await importCompiled('shared/mail/mailer.js');
    await verifySmtpConnection();
    smtpOk = true;
    result('smtp-transport', true);
  } catch (error) {
    result('smtp-transport', false, { code: errorCode(error) });
  }
} else {
  result('smtp-transport', false, { reason: 'not_configured' });
}

if (driveConfigured) {
  const { googleDriveService } = await importCompiled(
    'modules/integrations/google-drive.service.js',
  );
  driveOk = await googleDriveService.testRootAccess();
  result('google-drive-root', driveOk);
} else {
  result('google-drive-root', false, { reason: 'not_configured' });
}

if (followUpConfigured) {
  try {
    const { googleSheetsService } = await importCompiled(
      'modules/integrations/google-sheets.service.js',
    );
    const references = await googleSheetsService.readProcessReferences();
    followUpOk = references.length > 0;
    result('follow-up-references', followUpOk, { references: references.length });
  } catch (error) {
    result('follow-up-references', false, { code: errorCode(error) });
  }
} else {
  result('follow-up-references', false, { reason: 'not_configured' });
}

// A webhook do Google Chat só pode ser provado por envio real. O smoke valida
// apenas o formato para não publicar mensagens durante health checks/deploys.
result('google-chat', validChatWebhook(), { networkRequestSent: false });

const readingOk = emailIngestionEnabled && (gmailOk || imapOk);
const emailRequired = documentSource === 'email' || documentSource === 'both';
const driveRequired = documentSource === 'drive' || documentSource === 'both';
const followUpRequired = referenceSource !== 'legacy';
const operational =
  (!emailRequired || readingOk) &&
  (!driveRequired || driveOk) &&
  (!followUpRequired || followUpOk) &&
  smtpOk;
result('operational-summary', operational, {
  emailRequired,
  emailReading: readingOk,
  emailSendingTransport: smtpOk,
  driveRequired,
  driveReady: driveOk,
  followUpRequired,
  followUpReady: followUpOk,
});

// Importing compiled services also imports the shared database pool. A CLI smoke
// must terminate after reporting its result instead of waiting for that pool (or
// a failed provider socket) to become idle indefinitely.
process.exit(operational ? 0 : 1);
