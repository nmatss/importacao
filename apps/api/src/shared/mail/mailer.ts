import nodemailer from 'nodemailer';
import { settingsService } from '../../modules/settings/service.js';
import {
  getOperationalRecipient,
  parseEmailList,
} from '../../modules/settings/operational-recipients.js';
import { AppError } from '../errors/index.js';
import { parseMailFrom } from './mail-address.js';

/**
 * Central mail plane.
 *
 * Every outgoing message of the system goes through `buildOutgoingMail`, so the
 * two operational rules live in exactly one place:
 *
 *  1. Sender — messages are sent as the shared operational mailbox
 *     (`global@grupounico.com` by default), never as a personal account.
 *  2. Mandatory copy — the shared mailbox is always in CC so the operation keeps
 *     a single searchable archive of everything the system sends.
 *
 * Both are configurable (Configuracoes > E-mails, then env) but fall back to the
 * shared mailbox, so a missing configuration degrades to the correct address
 * instead of to a personal one.
 */

/** Operational mailbox of record. Used as sender and as mandatory copy. */
export const OPERATIONAL_MAILBOX = 'global@grupounico.com';

/** Default `From` header when nothing is configured. */
export const DEFAULT_MAIL_FROM = `"Uni.co Importacao" <${OPERATIONAL_MAILBOX}>`;

const MAX_CC_HEADER_LENGTH = 500;

/** Strips CR/LF from list headers whose addresses are validated separately. */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, '').trim();
}

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Extracts the bare address from a `From`-style header.
 * `"Uni.co Importacao" <global@grupounico.com>` -> `global@grupounico.com`
 */
export function extractEmailAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return (angled ? angled[1] : value).trim().toLowerCase();
}

/**
 * Resolves the `From` header: Configuracoes > SMTP, then `SMTP_FROM`, then the
 * operational mailbox.
 *
 * `SMTP_USER` is deliberately NOT part of the chain: it identifies the account
 * that authenticates against the relay, which is not necessarily the address the
 * operation must be seen sending from.
 */
export async function resolveMailFrom(): Promise<string> {
  const setting = await settingsService.get('smtp_from').catch(() => undefined);
  const dbValue = typeof setting?.value === 'string' ? setting.value.trim() : '';
  const envValue = process.env.SMTP_FROM?.trim() ?? '';
  const resolved = dbValue || envValue || DEFAULT_MAIL_FROM;

  const parsed = parseMailFrom(resolved);
  if (!parsed) {
    throw new AppError(
      'Remetente SMTP inválido. Use endereco@dominio.com ou "Nome" <endereco@dominio.com>.',
      503,
      'SMTP_FROM_INVALID',
    );
  }

  return parsed.header;
}

/**
 * Resolves the mandatory operational copy: Configuracoes > E-mails, then
 * `COMMUNICATION_DEFAULT_CC`, then the operational mailbox.
 *
 * Fails closed on a configured-but-malformed value: an operator who typed a bad
 * address must see the error instead of silently losing the copy. An *absent*
 * configuration is not an error — it falls back to the operational mailbox.
 */
export async function resolveMandatoryCc(): Promise<string[]> {
  const configured = await getOperationalRecipient('default_cc_email').catch(() => '');
  const recipients = parseEmailList(configured);

  if (recipients.length === 0) return [OPERATIONAL_MAILBOX];

  const joined = recipients.join(', ');
  if (
    recipients.some((recipient) => !isValidEmailAddress(recipient)) ||
    joined.length > MAX_CC_HEADER_LENGTH
  ) {
    throw new AppError(
      'Cópia operacional obrigatória inválida. Revise "Configurações > E-mails > Destinatários operacionais".',
      503,
      'DEFAULT_CC_INVALID',
    );
  }

  // The operational mailbox is the archive of record: guarantee it is in the
  // copy list even when an operator replaced the setting with other addresses.
  if (!recipients.includes(OPERATIONAL_MAILBOX)) recipients.push(OPERATIONAL_MAILBOX);

  return recipients;
}

export interface OutgoingMailHeaders {
  from: string;
  to: string;
  /** Effective CC header. Empty when every mandatory copy is already covered. */
  cc: string;
  /** Mandatory copy before de-duplication — persisted/audited as the intent. */
  mandatoryCc: string;
}

/**
 * Builds the `from`/`to`/`cc` headers for one outgoing message.
 *
 * De-duplication: an address is dropped from CC only when it is already a
 * primary recipient. The sender is intentionally not considered coverage.
 *
 * The operational mailbox remains explicitly in CC even when it is also the
 * sender. Besides preserving the contractual header on every relay, this keeps
 * the persisted/audited copy aligned with what Nodemailer actually sends.
 */
export async function buildOutgoingMail(recipientEmail: string): Promise<OutgoingMailHeaders> {
  const from = await resolveMailFrom();
  const mandatoryCc = await resolveMandatoryCc();

  const toRecipients = parseEmailList(recipientEmail);
  const alreadyCovered = new Set(toRecipients);

  const effectiveCc = mandatoryCc.filter((recipient) => !alreadyCovered.has(recipient));

  return {
    from,
    to: sanitizeHeader(toRecipients.join(', ')),
    cc: sanitizeHeader(effectiveCc.join(', ')),
    mandatoryCc: mandatoryCc.join(', '),
  };
}

/**
 * Builds the SMTP transport.
 *
 * Auth is skipped for the internal relay (which authorises by network, not by
 * credentials); certificate verification follows NODE_ENV unless an operator
 * explicitly opts out for a self-signed internal relay.
 */
async function resolveTransportSetting(key: string, envKey: string): Promise<string> {
  const setting = await settingsService.get(key).catch(() => undefined);
  const dbValue = typeof setting?.value === 'string' ? setting.value.trim() : '';
  return dbValue || process.env[envKey]?.trim() || '';
}

export async function getSmtpTransport() {
  const [host, portSetting, user] = await Promise.all([
    resolveTransportSetting('smtp_host', 'SMTP_HOST'),
    resolveTransportSetting('smtp_port', 'SMTP_PORT'),
    resolveTransportSetting('smtp_user', 'SMTP_USER'),
  ]);
  const port = Number(portSetting) || 587;
  if (!host) {
    throw new AppError('SMTP não configurado', 503, 'SMTP_NOT_CONFIGURED');
  }
  const secure = process.env.SMTP_SECURE === 'true';
  const pass = process.env.SMTP_PASS;
  const hasAuth = user && pass && user !== 'noreply@grupounico.com';

  const rejectUnauthorized =
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false'
      ? false
      : process.env.NODE_ENV === 'production';

  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(hasAuth ? { auth: { user, pass } } : {}),
    tls: { rejectUnauthorized, minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

/** Verifies SMTP connectivity and authentication without sending a message. */
export async function verifySmtpConnection(): Promise<void> {
  const transport = await getSmtpTransport();
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
