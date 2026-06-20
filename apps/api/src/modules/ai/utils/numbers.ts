/**
 * Shared decimal parser for the deterministic document parsers (invoice, packing
 * list, LI, proforma). Previously each parser carried a byte-identical copy of
 * this logic; that drift was a latent bug source (DocIntel audit 2026-06-20,
 * finding A2).
 *
 * Locale handling — the trade documents this project ingests (KIOM and most
 * Asian suppliers, rendered for a Brazilian importer) use **BR formatting**:
 * dot as thousands separator and comma as decimal (e.g. "24.312,52",
 * "1.533,60"). A single comma is therefore a DECIMAL separator here, NOT a US
 * thousands group — so "1,234" parses to 1.234, matching the source documents.
 *
 * What this fixes vs. the old copies: strings with MULTIPLE separators of the
 * same kind ("1.234.567" or "1,234,567") used to fall through to `Number()`
 * and return NaN -> null (silent data loss). They are now read as
 * thousands-grouped integers. Parenthesised negatives ("(123)") are also
 * supported, matching the orchestration layer's number parser.
 */
export function parseDecimal(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const str = String(value).trim();
  if (!str) return null;
  const parenNegative = /^\(.*\)$/.test(str);

  let clean = str.replace(/[^\d,.-]/g, '');
  if (!clean || clean === '-' || clean === '.' || clean === ',') return null;

  let sign = parenNegative ? -1 : 1;
  if (clean.startsWith('-')) {
    sign = -1;
    clean = clean.slice(1);
  }
  // Any remaining hyphen is an internal one (a range like "34-39" or an id), not
  // a number — reject so a size range can't be misread as a value.
  if (clean.includes('-')) return null;

  const commaCount = (clean.match(/,/g) || []).length;
  const dotCount = (clean.match(/\./g) || []).length;

  if (commaCount > 0 && dotCount > 0) {
    // Both present -> the LAST one is the decimal separator, the other groups.
    const decimal = clean.lastIndexOf(',') > clean.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    clean = clean.split(thousands).join('');
    if (decimal === ',') clean = clean.replace(',', '.');
  } else if (commaCount > 1) {
    // "1,234,567" -> every comma is a thousands separator.
    clean = clean.split(',').join('');
  } else if (commaCount === 1) {
    // Single comma = BR decimal separator ("1,5" -> 1.5).
    clean = clean.replace(',', '.');
  } else if (dotCount > 1) {
    // "1.234.567" -> every dot is a thousands separator.
    clean = clean.split('.').join('');
  }
  // Single dot (or none): leave as-is — Number() reads "8.50"/"1234.56" correctly.

  const parsed = Number(clean);
  if (!Number.isFinite(parsed)) return null;
  return sign * parsed;
}
