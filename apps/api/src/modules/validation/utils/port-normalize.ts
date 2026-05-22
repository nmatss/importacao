const COUNTRY_SUFFIX_RE =
  /[,;-]\s*(china|brazil|brasil|usa|united\s*states|hong\s*kong|singapore|vietnam|argentina|chile|portugal|spain|espanha|italy|italia|germany|alemanha|france|france|uk|united\s*kingdom)\b.*$/i;

const TRAILING_NOISE_RE = /[\s,;-]+$/;

export function normalizePort(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(COUNTRY_SUFFIX_RE, '')
    .replace(TRAILING_NOISE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function portsMatch(a: unknown, b: unknown): boolean {
  const na = normalizePort(a);
  const nb = normalizePort(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  return false;
}
