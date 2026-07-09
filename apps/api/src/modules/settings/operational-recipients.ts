import { settingsService } from './service.js';

export const OPERATIONAL_RECIPIENT_KEYS = [
  'kiom_email',
  'fenicia_email',
  'isa_email',
  'default_cc_email',
] as const;

export type OperationalRecipientKey = (typeof OPERATIONAL_RECIPIENT_KEYS)[number];

const RECIPIENT_ENV: Record<OperationalRecipientKey, string> = {
  kiom_email: 'KIOM_EMAIL',
  fenicia_email: 'FENICIA_EMAIL',
  isa_email: 'ISA_EMAIL',
  default_cc_email: 'COMMUNICATION_DEFAULT_CC',
};

export function parseEmailList(value: string | null | undefined): string[] {
  const seen = new Set<string>();

  return (value ?? '')
    .split(/[;,\r\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => {
      if (!email || seen.has(email)) return false;
      seen.add(email);
      return true;
    });
}

export function normalizeEmailList(value: string | null | undefined): string {
  return parseEmailList(value).join(', ');
}

export async function getOperationalRecipient(key: OperationalRecipientKey): Promise<string> {
  const setting = await settingsService.get(key);
  const rawValue = Array.isArray(setting?.value)
    ? setting.value.join(',')
    : typeof setting?.value === 'string'
      ? setting.value
      : '';
  const dbValue = normalizeEmailList(rawValue);
  return setting ? dbValue : normalizeEmailList(process.env[RECIPIENT_ENV[key]]);
}

export async function getOperationalRecipientSettings(): Promise<{ key: string; value: string }[]> {
  const results: { key: string; value: string }[] = [];

  for (const key of OPERATIONAL_RECIPIENT_KEYS) {
    results.push({ key, value: await getOperationalRecipient(key) });
  }

  return results;
}
