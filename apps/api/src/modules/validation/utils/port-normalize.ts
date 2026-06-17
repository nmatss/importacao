const COUNTRY_PATTERN = String.raw`p\.?\s*r\.?\s*china|prc|china|cn|brazil|brasil|br|usa|us|united\s*states|hong\s*kong|singapore|vietnam|argentina|chile|portugal|spain|espanha|italy|italia|germany|alemanha|france|uk|united\s*kingdom`;
const COUNTRY_SUFFIX_RE = new RegExp(
  String.raw`(?:\s*[\(,;/-]\s*|\s+)(${COUNTRY_PATTERN})(?:\s*\))?\s*$`,
  'i',
);
const TRAILING_PORT_TYPE_RE = /\s+(port|seaport|terminal)$/i;
const TRAILING_NOISE_RE = /[\s,;-]+$/;

export function normalizePort(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(COUNTRY_SUFFIX_RE, '')
    .replace(TRAILING_PORT_TYPE_RE, '')
    .replace(TRAILING_NOISE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function portsMatch(a: unknown, b: unknown): boolean {
  const na = normalizePort(a);
  const nb = normalizePort(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return false;
}
