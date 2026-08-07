import nodemailer from 'nodemailer';
import { settingsService } from '../../modules/settings/service.js';
import {
  getOperationalRecipient,
  parseEmailList,
} from '../../modules/settings/operational-recipients.js';
import { AppError } from '../errors/index.js';

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

/** Strips CR/LF so a configured value can never inject extra SMTP headers. */
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

  return sanitizeHeader(resolved) || DEFAULT_MAIL_FROM;
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
 * De-duplication: an address is dropped from CC when it is already the sender or
 * already a primary recipient, so the mailbox never receives the same message
 * twice from a single send.
 *
 * Sender case caveat: with the default configuration the sender *is* the
 * operational mailbox, so the copy is dropped and the archive depends on the
 * sending account keeping a Sent copy — true for Gmail/Workspace, false for a
 * plain SMTP relay. Set `MAIL_FORCE_OPERATIONAL_CC=true` to keep the mailbox in
 * CC even when it is also the sender, which guarantees an inbox copy on any relay.
 */
export async function buildOutgoingMail(recipientEmail: string): Promise<OutgoingMailHeaders> {
  const from = await resolveMailFrom();
  const mandatoryCc = await resolveMandatoryCc();

  const fromAddress = extractEmailAddress(from);
  const toRecipients = parseEmailList(recipientEmail);
  const forceSelfCopy = process.env.MAIL_FORCE_OPERATIONAL_CC === 'true';
  const alreadyCovered = new Set(forceSelfCopy ? toRecipients : [fromAddress, ...toRecipients]);

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
export function getSmtpTransport() {
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const hasAuth = user && pass && user !== 'noreply@grupounico.com';

  const rejectUnauthorized =
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false'
      ? false
      : process.env.NODE_ENV === 'production';

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    ...(hasAuth ? { auth: { user, pass } } : {}),
    tls: { rejectUnauthorized, minVersion: 'TLSv1.2' },
  });
}
