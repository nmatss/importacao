/**
 * Shared date-normalization library for the deterministic document parsers
 * (invoice / packing list / LI / proforma).
 *
 * GOAL: take the many ways a shipping/customs document can spell a date and
 * normalize ALL of them to a strict ISO-8601 calendar date (YYYY-MM-DD), so the
 * confidence harness (which checks `isIsoDate`) trusts deterministically-parsed
 * dates and the cross-document validation can compare them.
 *
 * Supported input shapes:
 *   - 2024-03-15            (already ISO)
 *   - 15/03/2024, 15-03-2024, 15.03.2024
 *   - 15/03/24             (2-digit year → 20xx)
 *   - 15-Mar-2024, 15 Mar 2024, 15-MAR-24
 *   - 15-jan-2024 / 15 dez 2024  (PT-BR month abbreviations)
 *   - "March 15, 2024" / "Mar 15 2024"
 *   - "15 de março de 2024" / "15 de marco de 2024" (PT-BR long form)
 *
 * mm/dd vs dd/mm AMBIGUITY — documented heuristic:
 *   Suppliers used by Grupo Uni.co (China/India/EU) write dd/mm/yyyy, and the
 *   Brazilian side also uses dd/mm/yyyy, so we DEFAULT TO dd/mm. We only flip to
 *   mm/dd when the first component is impossible as a day but possible as a
 *   month (i.e. first > 12 is treated as the day → dd/mm; first <= 12 AND
 *   second > 12 forces mm/dd because the second can't be a month). When BOTH
 *   components are <= 12 the date is genuinely ambiguous and we keep dd/mm.
 */

const MONTHS: Record<string, number> = {
  // English
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  // Portuguese (BR) — only the spellings that differ from the English stems
  fev: 2,
  abr: 4,
  mai: 5,
  ago: 8,
  set: 9,
  out: 10,
  dez: 12,
  // full names (EN + PT) so "March 15, 2024" / "15 de março de 2024" both work
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/** Strip accents + lowercase so "março"/"MARÇO" both resolve to "marco". */
function deburr(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function monthFromName(token: string): number | null {
  return MONTHS[deburr(token).replace(/\.$/, '')] ?? null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length <= 2) return 2000 + n;
  return n;
}

/** Validate a (y,m,d) triple is a real calendar date and emit ISO. */
function toIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Sentinela de sistema legado: Linx/WMS enviam 01/01/1900 como "vazio".
  // O lado Python já rejeita (`if parsed.year <= 1900: return None`); sem o
  // mesmo corte aqui, 1900-01-01 entrava em aiParsedData como data real e era
  // comparada no comparativo.
  if (year <= 1900 || year > 2100) return null;
  // Reject impossible days for the month (e.g. 31/02).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Resolve a numeric d/m pair under the documented dd/mm-default heuristic.
 * Returns [day, month].
 */
function resolveDayMonth(a: number, b: number): [number, number] | null {
  // First component impossible as a month → it must be the day (dd/mm).
  if (a > 12 && b <= 12) return [a, b];
  // Second component impossible as a month → first must be the month (mm/dd).
  if (b > 12 && a <= 12) return [b, a];
  // Both > 12 → impossible either way.
  if (a > 12 && b > 12) return null;
  // Both <= 12 → ambiguous; default to dd/mm.
  return [a, b];
}

/**
 * Parse a SINGLE already-isolated date token to ISO-8601, or null when it is
 * not a recognizable date. Whitespace-tolerant; case-insensitive.
 */
export function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim().replace(/\s+/g, ' ');
  if (!raw) return null;

  // 1) ISO already (YYYY-MM-DD), tolerate slashes/dots as separators too.
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // 2) dd-MMM-yyyy / dd MMM yyyy / dd.MMM.yyyy  (e.g. 22-Feb-26, 15 dez 2024)
  const dMonY = raw.match(/^(\d{1,2})[-/. ]([A-Za-zçÇ.]{3,9})[-/. ](\d{2,4})$/);
  if (dMonY) {
    const month = monthFromName(dMonY[2]);
    if (month) return toIso(expandYear(dMonY[3]), month, Number(dMonY[1]));
  }

  // 3) "March 15, 2024" / "Mar 15 2024"  (MMM dd, yyyy)
  const monDY = raw.match(/^([A-Za-zçÇ.]{3,9})[ .]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/);
  if (monDY) {
    const month = monthFromName(monDY[1]);
    if (month) return toIso(expandYear(monDY[3]), month, Number(monDY[2]));
  }

  // 4) PT-BR long form "15 de março de 2024"
  const ptLong = raw.match(/^(\d{1,2})\s+de\s+([A-Za-zçÇ]{3,9})\s+de\s+(\d{2,4})$/i);
  if (ptLong) {
    const month = monthFromName(ptLong[2]);
    if (month) return toIso(expandYear(ptLong[3]), month, Number(ptLong[1]));
  }

  // 5) Numeric dd/mm/yyyy family (also handles dd-mm, dd.mm).
  const numeric = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = expandYear(numeric[3]);
    const dm = resolveDayMonth(a, b);
    if (dm) return toIso(year, dm[1], dm[0]);
  }

  return null;
}

/**
 * The union of every separator/format the parsers anchor on, as a fragment that
 * can be embedded inside a labeled regex (e.g. `\binvoice\s*date\s*[:#-]?\s*(${DATE_VALUE_PATTERN})`).
 * Order matters: longer/more-specific alternatives first so the regex engine
 * does not stop early on a numeric prefix of a textual date.
 */
export const DATE_VALUE_PATTERN =
  // dd-MMM-yyyy / dd MMM yyyy
  String.raw`\d{1,2}[-/. ][A-Za-z]{3,9}[-/. ]\d{2,4}` +
  // MMM dd, yyyy
  String.raw`|[A-Za-z]{3,9}[ .]+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}` +
  // PT-BR long
  String.raw`|\d{1,2}\s+de\s+[A-Za-zçÇ]{3,9}\s+de\s+\d{2,4}` +
  // ISO
  String.raw`|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}` +
  // numeric dd/mm/yyyy family
  String.raw`|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}`;

/**
 * Labels (case-insensitive) the parsers anchor on to FIND a date in free text.
 * Broad on purpose — covers EN + PT-BR commercial/shipping vocabulary.
 */
export const DATE_LABELS: string[] = [
  'invoice date',
  'ci date',
  'date of issue',
  'issue date',
  'date',
  'data da fatura',
  'data emissao',
  'data de emissao',
  'data',
  'shipment date',
  'ship date',
  'date of shipment',
  'etd',
  'on board',
  'on board date',
  'shipped on board',
  'b/l date',
  'bl date',
  'data registro',
  'data de registro',
];

function escapeLabel(label: string): string {
  return label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`\s*`);
}

/**
 * Scan `text` for the FIRST date that follows one of the supplied labels (or
 * DATE_LABELS by default), normalized to ISO-8601. Labels are tried in order;
 * within a label the closest following date wins. Returns null when no labeled
 * date is found.
 *
 * The separator between label and value tolerates ':', '#', '-', or just
 * whitespace (compact PDF layouts glue label and value with no delimiter, e.g.
 * "CI DATE22-Feb-26").
 */
export function findLabeledDate(text: string, labels: string[] = DATE_LABELS): string | null {
  if (!text) return null;
  for (const label of labels) {
    const re = new RegExp(`${escapeLabel(label)}\\s*[:#-]?\\s*(${DATE_VALUE_PATTERN})`, 'i');
    const m = text.match(re);
    if (m?.[1]) {
      const iso = normalizeDate(m[1]);
      if (iso) return iso;
    }
  }
  return null;
}
