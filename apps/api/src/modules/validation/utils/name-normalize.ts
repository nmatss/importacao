const COMPANY_SUFFIXES = [
  'co.,ltd', 'co., ltd', 'co.ltd', 'co ltd', 'co.',
  'limited', 'ltd.', 'ltd',
  'ltda.', 'ltda',
  's.a.', 's/a', 'sa',
  'inc.', 'inc',
  'corp.', 'corp', 'corporation',
  'company',
  'gmbh', 'ag',
  'llc', 'llp',
];

const ADDRESS_HINT_RE =
  /\b(room|floor|\d+\/?f|building|tower|road|rd\.?|street|st\.?|avenue|ave\.?|av\.?|rua|avenida|numero|n[oº]|cep|cnpj|tel\.?|phone|fax|email)\b/i;

/**
 * Returns the "company name line" out of a multi-line blob. BL shipper / consignee fields
 * typically pack the company name on line 1 and address/phone on subsequent lines.
 * Falls back to the substring before the first address hint.
 */
export function extractCompanyLine(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? '';
  // If the first line already contains an address hint (company+address on one line),
  // slice at the first hint match.
  const hintMatch = firstLine.match(ADDRESS_HINT_RE);
  if (hintMatch && typeof hintMatch.index === 'number' && hintMatch.index > 0) {
    return firstLine.slice(0, hintMatch.index).trim().replace(/[,;\-]+$/g, '').trim();
  }
  return firstLine;
}

/** Aggressive normalization used for similarity comparison. */
export function normalizeCompanyName(value: unknown): string {
  let s = extractCompanyLine(value).toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  // remove punctuation except spaces
  s = s.replace(/[.,;:()\[\]{}'"\/\\|!?*<>@#%&^`~]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // drop common company suffixes
  for (const suffix of COMPANY_SUFFIXES) {
    const re = new RegExp(`(?:^|\\s)${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`, 'g');
    s = s.replace(re, ' ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Returns 0..1 similarity between two company names. */
export function companySimilarity(a: unknown, b: unknown): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.95;
  const tokensA = new Set(na.split(' ').filter(Boolean));
  const tokensB = new Set(nb.split(' ').filter(Boolean));
  const inter = new Set<string>();
  for (const t of tokensA) if (tokensB.has(t)) inter.add(t);
  const union = new Set([...tokensA, ...tokensB]);
  const jaccard = union.size ? inter.size / union.size : 0;
  const maxLen = Math.max(na.length, nb.length);
  const lev = maxLen ? 1 - levenshtein(na, nb) / maxLen : 0;
  // weighted average — both signals matter
  return Math.max(0, Math.min(1, 0.55 * jaccard + 0.45 * lev));
}

/** Pass/warning/fail thresholds for company name matching. */
export const COMPANY_PASS_THRESHOLD = 0.85;
export const COMPANY_WARN_THRESHOLD = 0.7;
